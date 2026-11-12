// @ts-check
// Embeddings: turn text into vectors, for semantic search and RAG.
//
//   const { vectors } = await embed('openai', ['first text', 'second text'], { dimensions: 768 });
//
// One function for every provider that has an embeddings API:
//   openai             POST /embeddings (also any OpenAI-compatible server, with baseUrl)
//   gemini             Gemini's OpenAI-compatible /embeddings
//   ollama             POST /api/embed on the local server
//   bedrock            Amazon Titan (amazon.titan-embed-*) or Cohere (cohere.embed-*), SigV4-signed
//   vertex             Vertex AI text-embedding models (:predict)
//   mock               deterministic vectors from a hash of the text, for tests and offline use
// Anthropic has no embeddings API, so it throws an ApiError naming the alternatives.
// No dependencies: fetch, plus the signing helpers already in this package.
import { ApiError, retryAfterMs } from './errors.js';
import { PROVIDERS } from './models.js';
import { awsCredentials, signRequest } from './providers/aws-sigv4.js';
import { createGoogleAuth } from './providers/google-auth.js';

/** Default embedding model per provider. */
export const EMBEDDING_MODELS = Object.freeze({
  openai: 'text-embedding-3-small',
  'openai-compatible': 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  ollama: 'nomic-embed-text',
  bedrock: 'amazon.titan-embed-text-v2:0',
  vertex: 'text-embedding-005',
  mock: 'mock-embedding',
});

/**
 * @typedef {Object} EmbedResult
 * @property {number[][]} vectors   one vector per input, in input order
 * @property {string} model         the model that produced them
 * @property {{ input_tokens: number }} usage
 */

/**
 * Embed one or more texts.
 *
 * @param {string} provider  openai, openai-compatible, gemini, ollama, bedrock, vertex, mock (anthropic throws)
 * @param {string | string[]} input
 * @param {{ model?: string, dimensions?: number, apiKey?: string, baseUrl?: string, region?: string, project?: string,
 *           env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, signal?: AbortSignal,
 *           auth?: { token: () => Promise<string> } }} [options]
 * @returns {Promise<EmbedResult>}
 */
export async function embed(provider, input, options = {}) {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return { vectors: [], model: options.model ?? EMBEDDING_MODELS[/** @type {keyof typeof EMBEDDING_MODELS} */ (provider)] ?? '', usage: { input_tokens: 0 } };
  if (texts.some((t) => typeof t !== 'string')) throw new TypeError('embed() takes a string or an array of strings');
  const { env = process.env, fetchImpl = fetch } = options;
  const model = options.model ?? EMBEDDING_MODELS[/** @type {keyof typeof EMBEDDING_MODELS} */ (provider)] ?? '';

  switch (provider) {
    case 'anthropic':
    case 'claude':
      throw new ApiError(400, 'invalid_request_error',
        'Anthropic has no embeddings API. Use openai, gemini, ollama, bedrock (Titan or Cohere) or vertex for embeddings, or mock in tests.');
    case 'mock':
      return mockEmbed(texts, model, options.dimensions ?? 16);
    case 'openai':
    case 'openai-compatible':
    case 'gemini': {
      const id = provider === 'openai-compatible' ? 'openai' : provider;
      const info = /** @type {{ label: string, envKeys: string[], baseUrl: string }} */ (PROVIDERS[id]);
      const apiKey = options.apiKey || info.envKeys.map((k) => env[k]).find(Boolean);
      const baseUrl = options.baseUrl || env[`${id.toUpperCase()}_BASE_URL`] || info.baseUrl;
      if (!apiKey && provider !== 'openai-compatible') throw new Error(`No API key for ${info.label} embeddings. Set ${info.envKeys.join(' or ')}.`);
      return openAIEmbed({ baseUrl, apiKey, model, texts, dimensions: options.dimensions, fetchImpl, signal: options.signal });
    }
    case 'ollama': {
      const root = (options.baseUrl || env.OLLAMA_BASE_URL || PROVIDERS.ollama?.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');
      const response = await fetchImpl(`${root}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts, ...(options.dimensions ? { dimensions: options.dimensions } : {}) }),
        signal: options.signal,
      });
      const json = await readJson(response, 'Ollama');
      return { vectors: json.embeddings, model: json.model ?? model, usage: { input_tokens: json.prompt_eval_count ?? 0 } };
    }
    case 'bedrock':
      return bedrockEmbed({ texts, model, options, env, fetchImpl });
    case 'vertex':
      return vertexEmbed({ texts, model, options, env, fetchImpl });
    default:
      throw new Error(`Provider "${provider}" has no embeddings support. Choose openai, gemini, ollama, bedrock, vertex or mock.`);
  }
}

/**
 * @param {{ baseUrl: string, apiKey?: string, model: string, texts: string[], dimensions?: number, fetchImpl: typeof fetch, signal?: AbortSignal }} o
 * @returns {Promise<EmbedResult>}
 */
async function openAIEmbed({ baseUrl, apiKey, model, texts, dimensions, fetchImpl, signal }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, input: texts, ...(dimensions ? { dimensions } : {}) }),
    signal,
  });
  const json = await readJson(response, 'Embeddings');
  const rows = [...json.data].sort((a, b) => a.index - b.index);
  return { vectors: rows.map((r) => r.embedding), model: json.model ?? model, usage: { input_tokens: json.usage?.prompt_tokens ?? 0 } };
}

/**
 * Titan takes one text per call; Cohere takes a batch.
 * @param {{ texts: string[], model: string, options: any, env: Record<string, string | undefined>, fetchImpl: typeof fetch }} o
 * @returns {Promise<EmbedResult>}
 */
async function bedrockEmbed({ texts, model, options, env, fetchImpl }) {
  const region = options.region || env.AWS_REGION || env.AWS_DEFAULT_REGION;
  const credentials = awsCredentials(env);
  if (!region) throw new Error('No AWS region for Bedrock. Set AWS_REGION.');
  if (!credentials) throw new Error('No AWS credentials for Bedrock. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  const host = options.baseUrl ?? `https://bedrock-runtime.${region}.amazonaws.com`;
  const url = `${host}/model/${encodeURIComponent(model)}/invoke`;
  /** @param {object} payload */
  const call = async (payload) => {
    const body = JSON.stringify(payload);
    const headers = signRequest({ method: 'POST', url, body, region, service: 'bedrock', credentials, headers: { 'content-type': 'application/json', accept: 'application/json' } });
    delete /** @type {Record<string, string | undefined>} */ (headers).host;
    return readJson(await fetchImpl(url, { method: 'POST', headers, body, signal: options.signal }), 'Bedrock');
  };
  if (model.startsWith('cohere.')) {
    const json = await call({ texts, input_type: 'search_document' });
    return { vectors: json.embeddings, model, usage: { input_tokens: 0 } };
  }
  const vectors = [];
  let tokens = 0;
  for (const text of texts) {
    const json = await call({ inputText: text, ...(options.dimensions ? { dimensions: options.dimensions } : {}), normalize: true });
    vectors.push(json.embedding);
    tokens += json.inputTextTokenCount ?? 0;
  }
  return { vectors, model, usage: { input_tokens: tokens } };
}

/**
 * @param {{ texts: string[], model: string, options: any, env: Record<string, string | undefined>, fetchImpl: typeof fetch }} o
 * @returns {Promise<EmbedResult>}
 */
async function vertexEmbed({ texts, model, options, env, fetchImpl }) {
  const project = options.project || env.VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
  const region = options.region || env.VERTEX_REGION || 'us-central1';
  if (!project) throw new Error('No Google Cloud project for Vertex AI. Set VERTEX_PROJECT_ID.');
  const google = options.auth ?? createGoogleAuth({ env, fetchImpl });
  const host = options.baseUrl ?? (region === 'global' ? 'https://aiplatform.googleapis.com' : `https://${region}-aiplatform.googleapis.com`);
  const url = `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models/${encodeURIComponent(model)}:predict`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await google.token()}` },
    body: JSON.stringify({
      instances: texts.map((content) => ({ content })),
      ...(options.dimensions ? { parameters: { outputDimensionality: options.dimensions } } : {}),
    }),
    signal: options.signal,
  });
  const json = await readJson(response, 'Vertex AI');
  const predictions = json.predictions ?? [];
  return {
    vectors: predictions.map((/** @type {any} */ p) => p.embeddings.values),
    model,
    usage: { input_tokens: predictions.reduce((/** @type {number} */ n, /** @type {any} */ p) => n + (p.embeddings.statistics?.token_count ?? 0), 0) },
  };
}

/**
 * Deterministic unit vectors from a hash of each text: identical texts get identical vectors,
 * texts sharing words land closer together. Not semantic; for tests and offline development.
 * @param {string[]} texts @param {string} model @param {number} dimensions
 * @returns {EmbedResult}
 */
function mockEmbed(texts, model, dimensions) {
  const vectors = texts.map((text) => {
    const v = new Array(dimensions).fill(0);
    for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
      v[Math.abs(h) % dimensions] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  });
  return { vectors, model, usage: { input_tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0) } };
}

/**
 * @param {Response} response @param {string} label
 * @returns {Promise<any>}
 */
async function readJson(response, label) {
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const error = Array.isArray(json) ? json[0]?.error : json.error;
    const message = typeof error === 'string' ? error : error?.message ?? json.message ?? response.statusText;
    throw new ApiError(response.status, error?.type ?? error?.status ?? 'unknown_error', `${label}: ${message}`, { retryAfterMs: retryAfterMs(response) });
  }
  return response.json();
}
