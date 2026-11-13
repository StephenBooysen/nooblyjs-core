// @ts-check
// Embeddings for every provider that has them, behind one call.
//
//   const embedder = createEmbedder('openai');                 // key from OPENAI_API_KEY
//   const { vectors, model, usage } = await embedder.embed(['text one', 'text two'], { dimensions: 768 });
//
// Which API each provider uses:
//   openai, gemini, ollama, deepseek, grok, openai-compatible   POST {baseUrl}/embeddings (the OpenAI shape)
//   bedrock    Titan (amazon.titan-embed-*: one text per call) or Cohere (cohere.embed-*: a batch per call), SigV4-signed
//   vertex     POST …/publishers/google/models/<model>:predict with a Google access token
//   mock       deterministic offline vectors, for tests
//   anthropic, azure  no embeddings endpoint: an ApiError names the providers that have one
//
// Vectors come back in the order of the input texts.
import { ApiError, retryAfterMs } from './errors.js';
import { DIRECT_APIS, PROVIDERS } from './models.js';
import { awsCredentials, signRequest } from './providers/aws-sigv4.js';
import { createGoogleAuth } from './providers/google-auth.js';
import { describeError } from './providers/openai-compatible.js';

/** The model each provider embeds with when none is given. */
export const DEFAULT_EMBEDDING_MODELS = Object.freeze({
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  ollama: 'nomic-embed-text',
  'openai-compatible': 'text-embedding-3-small',
  bedrock: 'amazon.titan-embed-text-v2:0',
  vertex: 'text-embedding-005',
  mock: 'mock-embedding',
});

/** Providers with an embeddings endpoint, for error messages. */
export const EMBEDDING_PROVIDERS = Object.freeze(['openai', 'gemini', 'ollama', 'openai-compatible', 'bedrock', 'vertex', 'mock']);

/**
 * @typedef {Object} EmbedResult
 * @property {number[][]} vectors   one per input text, same order
 * @property {string} model         the model that embedded them
 * @property {{ input_tokens: number }} usage
 */

/**
 * @typedef {Object} Embedder
 * @property {string} name
 * @property {(texts: string | string[], options?: { model?: string, dimensions?: number, signal?: AbortSignal }) => Promise<EmbedResult>} embed
 */

/**
 * Turns one string or a list into a list of strings, refusing anything else.
 * @param {string | string[]} texts
 * @returns {string[]}
 */
function toList(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  if (list.length === 0) throw new ApiError(400, 'invalid_request_error', 'embed() needs at least one text');
  if (list.some((t) => typeof t !== 'string')) throw new ApiError(400, 'invalid_request_error', 'embed() takes strings only');
  return list;
}

/**
 * An embedder for one provider.
 *
 * @param {string} id  catalogue id (openai, gemini, ollama, …), 'openai-compatible', 'bedrock', 'vertex' or 'mock'
 * @param {{ apiKey?: string, baseUrl?: string, model?: string, env?: Record<string, string | undefined>,
 *           fetchImpl?: typeof fetch, region?: string, credentials?: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
 *           project?: string, auth?: { token: () => Promise<string> }, now?: () => Date }} [options]
 * @returns {Embedder}
 */
export function createEmbedder(id, options = {}) {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === 'production' && DIRECT_APIS.includes(id)) {
    throw new Error(`The ${PROVIDERS[id]?.label ?? id} API is a direct public API, refused when NODE_ENV=production. Use bedrock or vertex for embeddings.`);
  }
  switch (id) {
    case 'mock': return createMockEmbedder();
    case 'bedrock': return createBedrockEmbedder(options);
    case 'vertex': return createVertexEmbedder(options);
    case 'anthropic':
    case 'azure':
      return {
        name: id,
        async embed() {
          throw new ApiError(400, 'unsupported', `${id === 'azure' ? 'Azure (Anthropic-compatible)' : 'Anthropic'} has no embeddings endpoint. Use one of: ${EMBEDDING_PROVIDERS.filter((p) => p !== 'mock').join(', ')}.`);
        },
      };
  }
  return createOpenAIEmbedder(id, options);
}

/**
 * The OpenAI embeddings API, which OpenAI, Gemini's compatible endpoint, Ollama and most local servers speak.
 * @param {string} id
 * @param {Parameters<typeof createEmbedder>[1]} options
 * @returns {Embedder}
 */
function createOpenAIEmbedder(id, { apiKey, baseUrl, model, env = process.env, fetchImpl = fetch } = {}) {
  const info = PROVIDERS[id];
  if (!info && id !== 'openai-compatible') {
    throw new Error(`Unknown embeddings provider "${id}". Choose one of: ${EMBEDDING_PROVIDERS.join(', ')}.`);
  }
  const key = apiKey || (info?.envKeys ?? []).map((name) => env[name]).find(Boolean);
  if (!key && info?.envKeys?.length) throw new Error(`No API key for ${info.label}. Set ${info.envKeys.join(' or ')}.`);
  const url = baseUrl || env[`${id.toUpperCase().replace(/-/g, '_')}_BASE_URL`] || info?.baseUrl;
  if (!url) throw new Error(`${info?.label ?? id} has no address. Pass a baseUrl.`);
  const defaultModel = model || /** @type {Record<string, string>} */ (DEFAULT_EMBEDDING_MODELS)[id] || DEFAULT_EMBEDDING_MODELS.openai;

  return {
    name: id,
    async embed(texts, { model: chosen, dimensions, signal } = {}) {
      const input = toList(texts);
      const body = { model: chosen || defaultModel, input, ...(dimensions ? { dimensions } : {}) };
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key ?? id}` },
        body: JSON.stringify(body),
        signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(response.status, ...describeError(json, response), { retryAfterMs: retryAfterMs(response) });
      const data = Array.isArray(json.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
      if (data.length !== input.length) throw new ApiError(502, 'bad_response', `${id} returned ${data.length} embeddings for ${input.length} texts`);
      return {
        vectors: data.map((d) => d.embedding),
        model: json.model || body.model,
        usage: { input_tokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0 },
      };
    },
  };
}

/**
 * Bedrock embeddings: Titan takes one text per call, Cohere a batch.
 * @param {Parameters<typeof createEmbedder>[1]} options
 * @returns {Embedder}
 */
function createBedrockEmbedder({ env = process.env, region = env.AWS_REGION || env.AWS_DEFAULT_REGION, credentials = awsCredentials(env) ?? undefined, model, baseUrl, fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!region) throw new Error('No AWS region for Bedrock. Set AWS_REGION.');
  if (!credentials) throw new Error('No AWS credentials for Bedrock. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  const host = baseUrl ?? `https://bedrock-runtime.${region}.amazonaws.com`;

  /** @param {string} modelId @param {object} payload @param {AbortSignal | undefined} signal */
  async function invoke(modelId, payload, signal) {
    const url = `${host}/model/${encodeURIComponent(modelId)}/invoke`;
    const body = JSON.stringify(payload);
    const headers = signRequest({ method: 'POST', url, headers: { 'content-type': 'application/json', accept: 'application/json' }, body, region: /** @type {string} */ (region), service: 'bedrock', credentials: /** @type {any} */ (credentials), date: now() });
    delete /** @type {Record<string, string | undefined>} */ (headers).host;
    const response = await fetchImpl(url, { method: 'POST', headers, body, signal });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const type = String(response.headers.get('x-amzn-errortype') ?? json.__type ?? 'unknown_error').split(':')[0];
      throw new ApiError(response.status, type, json.message ?? json.Message ?? response.statusText, { retryAfterMs: retryAfterMs(response) });
    }
    return json;
  }

  return {
    name: 'bedrock',
    async embed(texts, { model: chosen, dimensions, signal } = {}) {
      const input = toList(texts);
      const modelId = chosen || model || DEFAULT_EMBEDDING_MODELS.bedrock;
      if (modelId.startsWith('cohere.')) {
        const json = await invoke(modelId, { texts: input, input_type: 'search_document' }, signal);
        return { vectors: json.embeddings, model: modelId, usage: { input_tokens: 0 } };
      }
      const vectors = [];
      let tokens = 0;
      for (const text of input) {
        const json = await invoke(modelId, { inputText: text, ...(dimensions ? { dimensions } : {}) }, signal);
        vectors.push(json.embedding);
        tokens += json.inputTextTokenCount ?? 0;
      }
      return { vectors, model: modelId, usage: { input_tokens: tokens } };
    },
  };
}

/**
 * Vertex AI text embeddings (Google's own models, not Claude).
 * @param {Parameters<typeof createEmbedder>[1]} options
 * @returns {Embedder}
 */
function createVertexEmbedder({ env = process.env, project = env.VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT, region = env.VERTEX_EMBEDDING_REGION || env.VERTEX_REGION || 'us-central1', auth, model, baseUrl, fetchImpl = fetch } = {}) {
  if (!project) throw new Error('No Google Cloud project for Vertex AI. Set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT.');
  const google = auth ?? createGoogleAuth({ env, fetchImpl });
  // Embedding models are regional; "global" has no :predict endpoint for them.
  const location = region === 'global' ? 'us-central1' : region;
  const host = baseUrl ?? `https://${location}-aiplatform.googleapis.com`;

  return {
    name: 'vertex',
    async embed(texts, { model: chosen, dimensions, signal } = {}) {
      const input = toList(texts);
      const modelId = chosen || model || DEFAULT_EMBEDDING_MODELS.vertex;
      const url = `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(modelId)}:predict`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await google.token()}` },
        body: JSON.stringify({ instances: input.map((content) => ({ content })), ...(dimensions ? { parameters: { outputDimensionality: dimensions } } : {}) }),
        signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(response.status, ...describeError(json, response), { retryAfterMs: retryAfterMs(response) });
      /** @type {Array<{ embeddings?: { values?: number[], statistics?: { token_count?: number } } }>} */
      const predictions = json.predictions ?? [];
      return {
        vectors: predictions.map((p) => p.embeddings?.values ?? []),
        model: modelId,
        usage: { input_tokens: predictions.reduce((sum, p) => sum + (p.embeddings?.statistics?.token_count ?? 0), 0) },
      };
    },
  };
}

/**
 * Offline vectors: each token is hashed into a bucket, then the vector is normalised. The same text always gives
 * the same vector, and texts that share words point the same way, which is enough for tests.
 * @param {{ dimensions?: number }} [options]
 * @returns {Embedder}
 */
export function createMockEmbedder({ dimensions: fixed } = {}) {
  return {
    name: 'mock',
    async embed(texts, { dimensions } = {}) {
      const input = toList(texts);
      const size = dimensions || fixed || 64;
      const vectors = input.map((text) => {
        const vector = new Array(size).fill(0);
        for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
          let hash = 2166136261;
          for (let i = 0; i < token.length; i += 1) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
          vector[(hash >>> 0) % size] += 1;
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((v) => v / norm);
      });
      return { vectors, model: DEFAULT_EMBEDDING_MODELS.mock, usage: { input_tokens: input.reduce((n, t) => n + Math.ceil(t.length / 4), 0) } };
    },
  };
}

/**
 * One call without keeping the embedder: `embed('openai', ['a', 'b'])`.
 * @param {string} id
 * @param {string | string[]} texts
 * @param {Parameters<typeof createEmbedder>[1] & { dimensions?: number, signal?: AbortSignal }} [options]
 */
export function embed(id, texts, options = {}) {
  const { dimensions, signal, ...rest } = options;
  return createEmbedder(id, rest).embed(texts, { model: rest.model, dimensions, signal });
}
