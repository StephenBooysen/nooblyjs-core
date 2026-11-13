// Embeddings across providers: request shape, response order, errors and the production refusal.
// Offline: every call goes to a fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../../../../src/aiservice/common/errors.js';
import { createEmbedder, createMockEmbedder, embed, DEFAULT_EMBEDDING_MODELS } from '../../../../src/aiservice/common/embeddings.js';
import * as common from '../../../../src/aiservice/common/index.js';

/** A fake fetch that records requests and answers with the given JSON. */
function fakeFetch(answer, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const json = typeof answer === 'function' ? answer(calls.at(-1)) : answer;
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

test('the package index exports the embeddings API', () => {
  assert.equal(typeof common.createEmbedder, 'function');
  assert.equal(typeof common.embed, 'function');
});

test('OpenAI: posts to /embeddings and returns vectors in input order', async () => {
  const fetchImpl = fakeFetch({
    model: 'text-embedding-3-small',
    data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }],
    usage: { prompt_tokens: 6 },
  });
  const embedder = createEmbedder('openai', { apiKey: 'sk-test', fetchImpl, env: {} });
  const result = await embedder.embed(['first', 'second'], { dimensions: 2 });
  assert.deepEqual(result.vectors, [[1, 0], [0, 1]]);
  assert.equal(result.usage.input_tokens, 6);
  assert.match(fetchImpl.calls[0].url, /\/embeddings$/);
  assert.deepEqual(fetchImpl.calls[0].body, { model: 'text-embedding-3-small', input: ['first', 'second'], dimensions: 2 });
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer sk-test');
});

test('Ollama needs no key and uses its local address', async () => {
  const fetchImpl = fakeFetch({ data: [{ index: 0, embedding: [0.5] }] });
  const result = await createEmbedder('ollama', { fetchImpl, env: {} }).embed('hello');
  assert.equal(result.model, DEFAULT_EMBEDDING_MODELS.ollama);
  assert.match(fetchImpl.calls[0].url, /^http:\/\/localhost:11434\/v1\/embeddings$/);
});

test('Gemini goes through its OpenAI-compatible endpoint', async () => {
  const fetchImpl = fakeFetch({ data: [{ index: 0, embedding: [1] }] });
  await createEmbedder('gemini', { apiKey: 'g', fetchImpl, env: {} }).embed('x');
  assert.match(fetchImpl.calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/embeddings$/);
});

test('a provider error becomes an ApiError with the status', async () => {
  const fetchImpl = fakeFetch({ error: { type: 'invalid_request_error', message: 'bad model' } }, { status: 400 });
  await assert.rejects(
    createEmbedder('openai', { apiKey: 'k', fetchImpl, env: {} }).embed('x'),
    (err) => err instanceof ApiError && err.status === 400 && /bad model/.test(err.message)
  );
});

test('a reply with the wrong number of vectors is refused', async () => {
  const fetchImpl = fakeFetch({ data: [{ index: 0, embedding: [1] }] });
  await assert.rejects(createEmbedder('openai', { apiKey: 'k', fetchImpl, env: {} }).embed(['a', 'b']), /1 embeddings for 2 texts/);
});

test('rejects empty input and non-strings', async () => {
  const embedder = createMockEmbedder();
  await assert.rejects(embedder.embed([]), /at least one text/);
  await assert.rejects(embedder.embed([5]), /strings only/);
});

test('Anthropic and Azure have no embeddings endpoint', async () => {
  for (const id of ['anthropic', 'azure']) {
    await assert.rejects(createEmbedder(id, { env: {} }).embed('x'), (err) => err.status === 400 && /bedrock/.test(err.message));
  }
});

test('direct public APIs are refused in production', () => {
  assert.throws(() => createEmbedder('openai', { apiKey: 'k', env: { NODE_ENV: 'production' } }), /refused when NODE_ENV=production/);
});

test('a missing key is a clear error', () => {
  assert.throws(() => createEmbedder('openai', { env: {} }), /OPENAI_API_KEY/);
});

test('Bedrock Titan signs one request per text', async () => {
  const fetchImpl = fakeFetch(({ body }) => ({ embedding: [body.inputText.length], inputTextTokenCount: 2 }));
  const embedder = createEmbedder('bedrock', {
    region: 'us-east-1', credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' }, fetchImpl, env: {},
    now: () => new Date('2026-11-13T00:00:00Z'),
  });
  const result = await embedder.embed(['ab', 'abcd'], { dimensions: 256 });
  assert.deepEqual(result.vectors, [[2], [4]]);
  assert.equal(result.usage.input_tokens, 4);
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[0].url, /bedrock-runtime\.us-east-1\.amazonaws\.com\/model\/amazon\.titan-embed-text-v2%3A0\/invoke$/);
  assert.match(fetchImpl.calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20261113\/us-east-1\/bedrock\//);
  assert.equal(fetchImpl.calls[0].body.dimensions, 256);
});

test('Bedrock Cohere sends the batch in one request', async () => {
  const fetchImpl = fakeFetch({ embeddings: [[1], [2]] });
  const embedder = createEmbedder('bedrock', { region: 'eu-west-1', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, fetchImpl, env: {} });
  const result = await embedder.embed(['x', 'y'], { model: 'cohere.embed-english-v3' });
  assert.deepEqual(result.vectors, [[1], [2]]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(fetchImpl.calls[0].body.texts, ['x', 'y']);
});

test('Vertex posts instances to :predict with a Google token', async () => {
  const fetchImpl = fakeFetch({ predictions: [{ embeddings: { values: [0.1, 0.2], statistics: { token_count: 3 } } }] });
  const embedder = createEmbedder('vertex', { project: 'p1', region: 'global', auth: { token: async () => 'tok' }, fetchImpl, env: {} });
  const result = await embedder.embed('hello', { dimensions: 2 });
  assert.deepEqual(result.vectors, [[0.1, 0.2]]);
  assert.equal(result.usage.input_tokens, 3);
  assert.match(fetchImpl.calls[0].url, /us-central1-aiplatform\.googleapis\.com\/v1\/projects\/p1\/locations\/us-central1\/publishers\/google\/models\/text-embedding-005:predict$/);
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(fetchImpl.calls[0].body, { instances: [{ content: 'hello' }], parameters: { outputDimensionality: 2 } });
});

test('mock vectors are deterministic, normalised, and similar for shared words', async () => {
  const embedder = createMockEmbedder({ dimensions: 32 });
  const { vectors: [a, b, c] } = await embedder.embed(['reset my password', 'reset my password', 'banana smoothie recipe']);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(dot(a, b) > dot(a, c));
});

test('embed() is a one-call shortcut', async () => {
  const { vectors } = await embed('mock', ['a', 'b'], { dimensions: 4 });
  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, 4);
});
