/**
 * @fileoverview Meaning search (feature 01) through the aiservice embedding
 * backend. The stub AI service maps words of one idea to one vector, so a query
 * can match a document that shares no keyword with it. Checks semantic and
 * hybrid ranking, and that a failing embedding service is reported, not hidden.
 */
'use strict';

const { EventEmitter } = require('events');
const createSearching = require('../../../src/searching');

// Words of the same idea share a concept axis; the vector is one-hot on that axis.
const CONCEPTS = { password: 0, secret: 0, credential: 0, backup: 1, nightly: 1, queue: 2, retry: 2 };
const DIMS = 3;

function conceptVector(text) {
  const v = new Array(DIMS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z]+/g) || []) {
    if (word in CONCEPTS) v[CONCEPTS[word]] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function stubAi({ fail = false } = {}) {
  return {
    embed: jest.fn(async (texts) => {
      if (fail) throw new Error('embedding service unavailable');
      return { vectors: texts.map(conceptVector), model: 'stub-embed', usage: null };
    })
  };
}

function build(ai) {
  const emitter = new EventEmitter();
  const search = createSearching('vector', { embedding: { backend: 'aiservice', aiservice: ai, dimensions: DIMS, model: 'stub-embed' } }, emitter, {});
  search.testEmitter = emitter;
  return search;
}

describe('meaning search through the aiservice backend (feature 01)', () => {
  it('finds a document by meaning, with no shared keyword', async () => {
    const search = build(stubAi());
    await search.indexDocument('d1', 'Reset your password from the account page.', { title: 'Passwords' }, 'mean');
    await search.indexDocument('d2', 'Nightly backup runs at midnight.', { title: 'Backups' }, 'mean');
    await search.flushEmbeddings('mean');

    const hits = await search.semanticSearch('change my secret', { containerName: 'mean', limit: 2 });
    expect(hits[0].title).toBe('Passwords');
  });

  it('hybrid search keeps the meaning match first when keywords agree with it', async () => {
    const search = build(stubAi());
    await search.indexDocument('d1', 'Reset your password from the account page.', { title: 'Passwords' }, 'mean2');
    await search.indexDocument('d2', 'Retry a failed queue job with backoff.', { title: 'Queues' }, 'mean2');
    await search.flushEmbeddings('mean2');

    const hits = await search.hybridSearch('password reset', { containerName: 'mean2', limit: 2 });
    expect(hits[0].title).toBe('Passwords');
  });

  it('sends the document text to the embedding service in one batch', async () => {
    const ai = stubAi();
    const search = build(ai);
    await search.indexDocument('d1', 'queue retry policy', { title: 'Q' }, 'mean3');
    await search.flushEmbeddings('mean3');
    expect(ai.embed).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('queue')]), expect.objectContaining({ dimensions: DIMS }));
  });

  it('leaves documents without vectors when embedding fails, records why, and keeps keyword matching', async () => {
    const search = build(stubAi({ fail: true }));
    const complete = jest.fn();
    search.testEmitter.on('search:embed:complete', complete);
    await search.indexDocument('d1', 'password reset', { title: 'P' }, 'mean4');
    await search.flushEmbeddings('mean4');
    expect(search.lastEmbedError).toMatch(/embedding service unavailable/);
    // Known gap: the completion event still fires, with no vectors.
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ searchContainer: 'mean4', vectors: 0 }));
    const hits = await search.hybridSearch('password reset', { containerName: 'mean4', limit: 3 });
    expect(hits[0].title).toBe('P');
  });
});
