'use strict';
/** AI service provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, bool, any, arr } = require('../shared/config/schemaTypes');

const v2 = {
  properties: {
    model: str('Model id (default: the catalogue default for the provider)'),
    apiKey: str('API key (else the provider environment variable)'),
    baseUrl: str('Server address (required for openai-compatible)'),
    maxTokens: num('Default max output tokens'),
    temperature: num('Default temperature'),
    system: str('Default system prompt'),
    maxCostPerDay: num('Daily budget in USD'),
    maxTokensPerRequest: num('Token cap per request'),
    embeddingProvider: str('Embeddings backend when it differs from the chat provider'),
    embeddingModel: str('Embeddings model'),
    embeddingApiKey: str('Key for the embeddings backend'),
    embeddingBaseUrl: str('Address of the embeddings backend'),
    script: arr('Scripted replies (mock)'),
    provider: any('A ready provider object'),
    providerOptions: any('Extra options for the common provider (region, project, ...)'),
    legacy: bool('false: use AI Service v2 for a pre-v2 name'),
    tokensStorePath: str('Token usage file'),
    apikey: str('API key (old spelling)')
  }
};
const legacy = (extra = {}) => ({
  properties: {
    ...v2.properties,
    apikey: str('API key (old spelling)'),
    maxtokens: num('Max tokens (old spelling)'),
    endpoint: str('Endpoint'),
    apiVersion: str('API version'),
    deployment: str('Azure deployment'),
    ...extra
  }
});

module.exports = {
  common: { properties: {} },
  providers: {
    anthropic: v2, 'openai-compatible': v2, grok: v2, deepseek: v2, bedrock: v2, vertex: v2, azure: v2, mock: v2,
    claude: legacy(), openai: legacy(), chatgpt: legacy(), gemini: legacy(), ollama: legacy({ stream: bool('Stream replies') }),
    'openai-kv': legacy({
      keyVaultUrl: str('Key Vault URL'), keyvaultUrl: str('Key Vault URL (old spelling)'), tenantId: str('Tenant id'),
      clientId: str('Client id'), clientSecret: str('Client secret'), secretNames: any('Secret names')
    }),
    tensorflow: {
      open: true,
      properties: {
        modelPath: str('Model folder'), epochs: num('Epochs'), batchSize: num('Batch size'), sequenceLength: num('Sequence length'),
        embeddingDim: num('Embedding size'), lstmUnits: num('LSTM units'), maxTokens: num('Max tokens'), temperature: num('Temperature'),
        trainDebounceMs: num('Training debounce in ms')
      }
    }
  }
};
