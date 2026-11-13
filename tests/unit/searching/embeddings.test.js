/**
 * @fileoverview Unit tests for the semantic-search embedding client.
 *
 * Everything here runs offline. That is not only for speed: the hash backend
 * exists precisely so the embedding path is reproducible and testable without
 * an API key or outbound network, and these tests are what hold it to that.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-08-27
 */

'use strict';

const {
  EmbeddingClient,
  hashEmbed,
  chunkText,
  normalize
} = require('../../../src/searching/modules/embeddings');

/** Cosine similarity of two unit vectors — a plain dot product. */
const cosine = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

/** Squared length, for asserting normalization. */
const magnitude = (v) => Math.sqrt(cosine(v, v));

/** An in-memory stand-in for the caching service (`get` / `put`). */
const makeCache = () => {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (key) => store.get(key)),
    put: jest.fn(async (key, value) => { store.set(key, value); })
  };
};

describe('normalize', () => {
  it('scales a vector to unit length', () => {
    const v = normalize(Float32Array.from([3, 4]));
    expect(magnitude(v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
  });

  it('leaves a zero vector alone rather than dividing by zero', () => {
    const v = normalize(new Float32Array(4));
    expect(Array.from(v)).toEqual([0, 0, 0, 0]);
  });

  it('normalizes in place and returns the same instance', () => {
    const v = Float32Array.from([5, 0]);
    expect(normalize(v)).toBe(v);
  });
});

describe('hashEmbed', () => {
  it('is deterministic — the same text always gives the same vector', () => {
    const a = hashEmbed('how do I reset my password', 64);
    const b = hashEmbed('how do I reset my password', 64);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('honours the requested width', () => {
    expect(hashEmbed('anything', 16)).toHaveLength(16);
    expect(hashEmbed('anything', 384)).toHaveLength(384);
  });

  it('returns unit-length vectors', () => {
    expect(magnitude(hashEmbed('credential recovery procedure', 128))).toBeCloseTo(1, 5);
  });

  it('returns an all-zero vector for empty text, without dividing by zero', () => {
    const v = hashEmbed('', 8);
    expect(Array.from(v)).toEqual(new Array(8).fill(0));
    expect(Array.from(hashEmbed('   ', 8))).toEqual(new Array(8).fill(0));
  });

  it('is order-free — it embeds a bag of words', () => {
    const a = hashEmbed('password reset', 64);
    const b = hashEmbed('reset password', 64);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('ignores case and punctuation', () => {
    const a = hashEmbed('Password, Reset!', 64);
    const b = hashEmbed('password reset', 64);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('scores shared vocabulary above disjoint vocabulary', () => {
    const query = hashEmbed('reset password', 384);
    const related = hashEmbed('password reset instructions', 384);
    const unrelated = hashEmbed('quarterly revenue forecast', 384);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it('damps repeated terms sublinearly rather than letting them dominate', () => {
    const once = hashEmbed('alpha beta', 64);
    const many = hashEmbed('alpha alpha alpha alpha alpha alpha beta', 64);
    // Both are unit length, so a raw-count weighting would push `many` far from
    // `once`; sublinear weighting keeps them recognisably similar.
    expect(cosine(once, many)).toBeGreaterThan(0.8);
  });
});

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  it('returns a single chunk when the text already fits', () => {
    const chunks = chunkText('short enough', { maxChars: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ text: 'short enough', index: 0, start: 0 });
  });

  it('splits long text into sequentially indexed chunks within the size limit', () => {
    const text = 'word '.repeat(200).trim(); // ~999 chars
    const chunks = chunkText(text, { maxChars: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.text.length).toBeLessThanOrEqual(100);
      expect(chunk.index).toBe(i);
    });
  });

  it('overlaps consecutive chunks so a passage is never split out of both', () => {
    const text = 'word '.repeat(200).trim();
    const chunks = chunkText(text, { maxChars: 100, overlap: 30 });

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeLessThan(chunks[i - 1].end);
    }
  });

  it('prefers to break at a sentence boundary', () => {
    const first = `${'a'.repeat(70)}. `;
    const chunks = chunkText(first + 'b'.repeat(200), { maxChars: 100, overlap: 0 });
    expect(chunks[0].text).toBe(`${'a'.repeat(70)}.`);
  });

  it('does not split on a decimal point or an abbreviation', () => {
    // No whitespace after the '.', so it is not a sentence end.
    const text = `${'x'.repeat(70)}3.5${'y'.repeat(60)}`;
    const chunks = chunkText(text, { maxChars: 100, overlap: 0 });
    expect(chunks[0].text).not.toMatch(/3\.$/);
  });

  it('falls back to a word boundary, then to a hard cut', () => {
    const unbroken = 'z'.repeat(250);
    const chunks = chunkText(unbroken, { maxChars: 100, overlap: 0 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toHaveLength(100);
  });

  it('always makes forward progress, even with a pathological overlap', () => {
    const chunks = chunkText('q'.repeat(200), { maxChars: 20, overlap: 19 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(200);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start);
    }
  });
});

describe('EmbeddingClient — hash backend', () => {
  it('embeds a single text to a unit vector of the configured width', async () => {
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 64 });
    const vector = await client.embed('reset my password');

    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector).toHaveLength(64);
    expect(magnitude(vector)).toBeCloseTo(1, 5);
  });

  it('embeds a batch positionally', async () => {
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 32 });
    const vectors = await client.embedBatch(['alpha', 'beta', 'gamma']);

    expect(vectors).toHaveLength(3);
    expect(Array.from(vectors[0])).toEqual(Array.from(hashEmbed('alpha', 32)));
    expect(Array.from(vectors[2])).toEqual(Array.from(hashEmbed('gamma', 32)));
  });

  it('returns null for blank texts while still embedding their neighbours', async () => {
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 32 });
    const vectors = await client.embedBatch(['alpha', '', '   ', null, 'beta']);

    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[1]).toBeNull();
    expect(vectors[2]).toBeNull();
    expect(vectors[3]).toBeNull();
    expect(vectors[4]).toBeInstanceOf(Float32Array);
  });

  it('returns an empty array for an empty batch and rejects a non-array', async () => {
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 8 });
    await expect(client.embedBatch([])).resolves.toEqual([]);
    await expect(client.embedBatch('not an array')).rejects.toThrow(/requires an array/);
  });

  it('describes its configuration for the status endpoint', () => {
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 384 });
    expect(client.describe()).toEqual({
      backend: 'hash',
      model: 'hash-384',
      dimensions: 384,
      cached: false,
      batchSize: 64
    });
  });
});

describe('EmbeddingClient — batching', () => {
  it('splits work into batches of batchSize', async () => {
    const calls = [];
    const client = new EmbeddingClient({
      dimensions: 8,
      batchSize: 2,
      embed: async (texts) => {
        calls.push(texts.length);
        return texts.map(t => Array.from(hashEmbed(t, 8)));
      }
    });

    const vectors = await client.embedBatch(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toEqual([2, 2, 1]);
    expect(vectors.filter(Boolean)).toHaveLength(5);
  });
});

describe('EmbeddingClient — caching', () => {
  it('serves repeat texts from the cache without calling the backend again', async () => {
    const cache = makeCache();
    let backendCalls = 0;
    const client = new EmbeddingClient({
      dimensions: 8,
      cache,
      embed: async (texts) => {
        backendCalls++;
        return texts.map(t => Array.from(hashEmbed(t, 8)));
      }
    });

    const first = await client.embedBatch(['alpha', 'beta']);
    expect(backendCalls).toBe(1);
    expect(client.stats.cacheMisses).toBe(2);

    const second = await client.embedBatch(['alpha', 'beta']);
    expect(backendCalls).toBe(1); // untouched
    expect(client.stats.cacheHits).toBe(2);
    expect(Array.from(second[0])).toEqual(Array.from(first[0]));
  });

  it('stores vectors as plain arrays so a file or Redis cache can serialize them', async () => {
    const cache = makeCache();
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 8, cache });
    await client.embed('alpha');

    const [stored] = Array.from(cache.store.values());
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(8);
  });

  it('accepts a cache exposing set() instead of put()', async () => {
    const store = new Map();
    const cache = {
      get: async (key) => store.get(key),
      set: async (key, value) => { store.set(key, value); }
    };
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 8, cache });

    await client.embed('alpha');
    expect(store.size).toBe(1);
    await client.embed('alpha');
    expect(client.stats.cacheHits).toBe(1);
  });

  it('keys the cache on the model, so changing model does not reuse old vectors', async () => {
    const cache = makeCache();
    const optionsFor = (model) => ({
      dimensions: 8, cache, model,
      embed: async (texts) => texts.map(t => Array.from(hashEmbed(t, 8)))
    });

    await new EmbeddingClient(optionsFor('model-a')).embed('alpha');
    const clientB = new EmbeddingClient(optionsFor('model-b'));
    await clientB.embed('alpha');

    expect(cache.store.size).toBe(2);
    expect(clientB.stats.cacheHits).toBe(0);
  });

  it('ignores a cache entry of the wrong width rather than returning a bad vector', async () => {
    const cache = makeCache();
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 8, cache, model: 'm' });
    await client.embed('alpha');

    const [key] = Array.from(cache.store.keys());
    cache.store.set(key, [1, 2, 3]); // stale entry from a different configuration

    const vector = await client.embed('alpha');
    expect(vector).toHaveLength(8);
  });

  it('survives a cache that throws', async () => {
    const cache = {
      get: async () => { throw new Error('cache down'); },
      put: async () => { throw new Error('cache down'); }
    };
    const client = new EmbeddingClient({ backend: 'hash', dimensions: 8, cache });
    await expect(client.embed('alpha')).resolves.toHaveLength(8);
  });
});

describe('EmbeddingClient — failure handling', () => {
  it('retries a rate-limited call and succeeds', async () => {
    let attempts = 0;
    const client = new EmbeddingClient({
      dimensions: 8,
      retryBaseMs: 0,
      embed: async (texts) => {
        attempts++;
        if (attempts <= 2) {
          throw Object.assign(new Error('Too Many Requests'), { status: 429 });
        }
        return texts.map(t => Array.from(hashEmbed(t, 8)));
      }
    });

    const vector = await client.embed('alpha');
    expect(attempts).toBe(3);
    expect(client.stats.retries).toBe(2);
    expect(vector).toHaveLength(8);
  });

  it('retries a transient network error', async () => {
    let attempts = 0;
    const client = new EmbeddingClient({
      dimensions: 8,
      retryBaseMs: 0,
      embed: async (texts) => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return texts.map(t => Array.from(hashEmbed(t, 8)));
      }
    });

    await expect(client.embed('alpha')).resolves.toHaveLength(8);
    expect(attempts).toBe(2);
  });

  it('gives up after maxRetries and yields nulls instead of throwing', async () => {
    let attempts = 0;
    const warn = jest.fn();
    const client = new EmbeddingClient({
      dimensions: 8,
      retryBaseMs: 0,
      maxRetries: 2,
      embed: async () => {
        attempts++;
        throw Object.assign(new Error('still rate limited'), { status: 429 });
      }
    }, { logging: { warn } });

    const vectors = await client.embedBatch(['alpha', 'beta']);
    expect(attempts).toBe(3); // initial + 2 retries
    expect(vectors).toEqual([null, null]);
    expect(client.stats.failures).toBe(2);
    expect(client.lastError).toMatch(/still rate limited/);
    expect(warn).toHaveBeenCalled();
  });

  it('does not retry a client error, and does not throw', async () => {
    let attempts = 0;
    const client = new EmbeddingClient({
      dimensions: 8,
      retryBaseMs: 0,
      embed: async () => {
        attempts++;
        throw Object.assign(new Error('Bad Request'), { status: 400 });
      }
    });

    await expect(client.embedBatch(['alpha'])).resolves.toEqual([null]);
    expect(attempts).toBe(1);
  });

  it('lets one failing batch fail without poisoning the others', async () => {
    const client = new EmbeddingClient({
      dimensions: 8,
      batchSize: 1,
      retryBaseMs: 0,
      embed: async (texts) => {
        if (texts[0] === 'poison') throw Object.assign(new Error('nope'), { status: 400 });
        return texts.map(t => Array.from(hashEmbed(t, 8)));
      }
    });

    const vectors = await client.embedBatch(['alpha', 'poison', 'beta']);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors[1]).toBeNull();
    expect(vectors[2]).toBeInstanceOf(Float32Array);
  });

  it('throws on a dimension mismatch — a configuration fault, not a document fault', async () => {
    const client = new EmbeddingClient({
      dimensions: 4,
      retryBaseMs: 0,
      embed: async (texts) => texts.map(() => [1, 2, 3, 4, 5, 6, 7, 8])
    });

    await expect(client.embed('alpha')).rejects.toThrow(/not comparable/);
  });

  it('does not retry a dimension mismatch', async () => {
    let attempts = 0;
    const client = new EmbeddingClient({
      dimensions: 4,
      retryBaseMs: 0,
      embed: async (texts) => { attempts++; return texts.map(() => [1, 2]); }
    });

    await expect(client.embed('alpha')).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('rejects a backend that does not return an array of vectors', async () => {
    const client = new EmbeddingClient({
      dimensions: 4,
      retryBaseMs: 0,
      embed: async () => ({ oops: true })
    });
    await expect(client.embedBatch(['alpha'])).resolves.toEqual([null]);
  });
});

describe('EmbeddingClient — aiservice backend', () => {
  it('refuses to construct without an aiservice instance', () => {
    expect(() => new EmbeddingClient({ backend: 'aiservice' }))
      .toThrow(/requires an aiservice instance/);
  });

  it('delegates to aiservice.embed and passes model and dimensions through', async () => {
    const embed = jest.fn(async (texts) => ({
      embeddings: texts.map(t => Array.from(hashEmbed(t, 16))),
      model: 'text-embedding-3-small'
    }));
    const client = new EmbeddingClient({
      backend: 'aiservice',
      model: 'text-embedding-3-small',
      dimensions: 16,
      aiservice: { embed }
    });

    const vectors = await client.embedBatch(['alpha', 'beta']);

    expect(embed).toHaveBeenCalledWith(
      ['alpha', 'beta'],
      { model: 'text-embedding-3-small', dimensions: 16 }
    );
    expect(vectors[0]).toHaveLength(16);
  });

  it('reads the vectors field that the shared-module aiservice returns', async () => {
    const client = new EmbeddingClient({
      backend: 'aiservice',
      dimensions: 16,
      aiservice: { embed: async (texts) => ({ vectors: texts.map(t => Array.from(hashEmbed(t, 16))), model: 'm' }) }
    });
    const vectors = await client.embedBatch(['alpha']);
    expect(vectors[0]).toHaveLength(16);
  });

  it('also accepts a bare array of vectors from aiservice.embed', async () => {
    const client = new EmbeddingClient({
      backend: 'aiservice',
      dimensions: 16,
      aiservice: { embed: async (texts) => texts.map(t => Array.from(hashEmbed(t, 16))) }
    });
    await expect(client.embed('alpha')).resolves.toHaveLength(16);
  });

  it('re-normalizes whatever the backend returns', async () => {
    const client = new EmbeddingClient({
      dimensions: 3,
      embed: async () => [[3, 0, 4]] // length 5, not 1
    });
    const vector = await client.embed('alpha');
    expect(magnitude(vector)).toBeCloseTo(1, 6);
  });
});
