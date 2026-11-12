import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embed, EMBEDDING_MODELS } from '../../../../src/aiservice/common/embeddings.js';
import { ApiError } from '../../../../src/aiservice/common/errors.js';

/** A fetch stub that records the request and answers with `json`. */
function stubFetch(json, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(typeof json === 'function' ? json(calls.length) : json), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

test('mock vectors are deterministic, unit length and of the asked dimension', async () => {
  const a = await embed('mock', ['hello world', 'hello world', 'other'], { dimensions: 8 });
  assert.equal(a.vectors.length, 3);
  assert.equal(a.vectors[0].length, 8);
  assert.deepEqual(a.vectors[0], a.vectors[1]);
  assert.ok(Math.abs(Math.hypot(...a.vectors[0]) - 1) < 1e-9);
  assert.equal(a.model, EMBEDDING_MODELS.mock);
});

test('openai: posts the batch and returns vectors in input order', async () => {
  const { fetchImpl, calls } = stubFetch({ model: 'text-embedding-3-small', data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 7 } });
  const r = await embed('openai', ['a', 'b'], { apiKey: 'k', dimensions: 2, fetchImpl });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/embeddings');
  assert.equal(calls[0].init.headers.authorization, 'Bearer k');
  assert.deepEqual(calls[0].body, { model: 'text-embedding-3-small', input: ['a', 'b'], dimensions: 2 });
  assert.deepEqual(r.vectors, [[1, 0], [0, 1]]);
  assert.equal(r.usage.input_tokens, 7);
});

test('openai-compatible goes to the given baseUrl without a key', async () => {
  const { fetchImpl, calls } = stubFetch({ data: [{ index: 0, embedding: [1] }] });
  await embed('openai-compatible', 'x', { baseUrl: 'http://localhost:1234/v1/', model: 'local', fetchImpl, env: {} });
  assert.equal(calls[0].url, 'http://localhost:1234/v1/embeddings');
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('gemini uses its OpenAI-compatible endpoint', async () => {
  const { fetchImpl, calls } = stubFetch({ data: [{ index: 0, embedding: [1] }] });
  await embed('gemini', 'x', { fetchImpl, env: { GEMINI_API_KEY: 'g' } });
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/embeddings$/);
  assert.equal(calls[0].body.model, 'gemini-embedding-001');
});

test('ollama posts to /api/embed on the server root', async () => {
  const { fetchImpl, calls } = stubFetch({ model: 'nomic-embed-text', embeddings: [[0.5]], prompt_eval_count: 3 });
  const r = await embed('ollama', ['x'], { fetchImpl, env: {} });
  assert.equal(calls[0].url, 'http://localhost:11434/api/embed');
  assert.deepEqual(r.vectors, [[0.5]]);
  assert.equal(r.usage.input_tokens, 3);
});

test('bedrock Titan signs one call per text; Cohere sends the batch', async () => {
  const env = { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKID', AWS_SECRET_ACCESS_KEY: 'secret' };
  const titan = stubFetch((n) => ({ embedding: [n], inputTextTokenCount: 2 }));
  const r = await embed('bedrock', ['a', 'b'], { env, fetchImpl: titan.fetchImpl, dimensions: 256 });
  assert.equal(titan.calls.length, 2);
  assert.match(titan.calls[0].url, /bedrock-runtime\.us-east-1\.amazonaws\.com\/model\/amazon\.titan-embed-text-v2%3A0\/invoke$/);
  assert.match(titan.calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\//);
  assert.deepEqual(titan.calls[0].body, { inputText: 'a', dimensions: 256, normalize: true });
  assert.deepEqual(r.vectors, [[1], [2]]);
  assert.equal(r.usage.input_tokens, 4);

  const cohere = stubFetch({ embeddings: [[1], [2]] });
  const c = await embed('bedrock', ['a', 'b'], { env, model: 'cohere.embed-english-v3', fetchImpl: cohere.fetchImpl });
  assert.equal(cohere.calls.length, 1);
  assert.deepEqual(cohere.calls[0].body, { texts: ['a', 'b'], input_type: 'search_document' });
  assert.deepEqual(c.vectors, [[1], [2]]);
});

test('vertex calls :predict with a Google token', async () => {
  const { fetchImpl, calls } = stubFetch({ predictions: [{ embeddings: { values: [1, 2], statistics: { token_count: 4 } } }] });
  const r = await embed('vertex', 'x', { env: { VERTEX_PROJECT_ID: 'p' }, auth: { token: async () => 'tok' }, fetchImpl, dimensions: 2 });
  assert.match(calls[0].url, /us-central1-aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/us-central1\/publishers\/google\/models\/text-embedding-005:predict$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(calls[0].body, { instances: [{ content: 'x' }], parameters: { outputDimensionality: 2 } });
  assert.deepEqual(r.vectors, [[1, 2]]);
  assert.equal(r.usage.input_tokens, 4);
});

test('anthropic throws an ApiError naming the alternatives', async () => {
  await assert.rejects(embed('anthropic', 'x'), (e) => e instanceof ApiError && /openai, gemini, ollama/.test(e.message));
});

test('HTTP errors become ApiErrors with the status', async () => {
  const { fetchImpl } = stubFetch({ error: { message: 'bad key', type: 'auth' } }, 401);
  await assert.rejects(embed('openai', 'x', { apiKey: 'k', fetchImpl }), (e) => e instanceof ApiError && e.status === 401 && /bad key/.test(e.message));
});

test('empty input needs no request; non-strings are refused', async () => {
  assert.deepEqual((await embed('openai', [], { fetchImpl: () => { throw new Error('no'); } })).vectors, []);
  await assert.rejects(embed('mock', [1]), TypeError);
});
