/**
 * @fileoverview Azure OpenAI (Key Vault) Provider
 * Azure OpenAI implementation that authenticates through Azure Key Vault using
 * a two-stage App Registration flow, avoiding any API keys in code or config.
 *
 *  STAGE 1 - Connect to Key Vault using App Registration #1.
 *  STAGE 2 - Retrieve App Registration #2 credentials from Key Vault.
 *  STAGE 3 - Connect to Azure OpenAI using App Registration #2 (Azure AD token).
 *
 * The framework's service factory is synchronous, so the three stages run
 * lazily on the first prompt() call and the result is memoised.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const AIServiceBase = require('./aibase');
const { AzureOpenAI } = require('openai');
const { ClientSecretCredential } = requireOptional('@azure/identity', "aiservice('openai-kv')");
const { SecretClient } = requireOptional('@azure/keyvault-secrets', "aiservice('openai-kv')");

/**
 * Default Key Vault secret names holding App Registration #2 credentials.
 * Override individual names via options.secretNames.
 * @const {Object<string,string>}
 */
const DEFAULT_SECRET_NAMES = {
  tenantId: 'openai-app-tenant-id',
  clientId: 'openai-app-client-id',
  clientSecret: 'openai-app-client-secret',
  endpoint: 'openai-endpoint',
  deploymentName: 'openai-deployment-name'
};

/** Azure AD scope used to request a bearer token for Azure OpenAI. */
const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

/** Default Azure OpenAI REST API version. */
const DEFAULT_AZURE_API_VERSION = '2024-12-01-preview';

/**
 * True when a deployment addresses a reasoning model (gpt-5 family or o-series).
 *
 * The string tested is an Azure DEPLOYMENT name, not a model id: it is chosen by
 * whoever created the deployment and commonly prefixes the family with an
 * environment or project tag ("krsa-poc-gpt-5-nano"). The family is therefore
 * matched anywhere in the name, bounded by non-alphanumeric characters so a
 * substring can't match by accident.
 *
 * The boundary is what keeps "gpt-4o" — a NON-reasoning model — out of the
 * o-series branch: its "o" follows the digit 4, so `o[1-9]` never lines up. Only
 * a genuine o-series tag ("o1", "o3-mini", "prod-o4") matches.
 *
 * Reasoning models matter here because they bill hidden reasoning tokens against
 * the completion budget: too small a cap is spent thinking and the response comes
 * back with empty content and no error at all.
 *
 * @param {string} deploymentName - The Azure deployment name (or model id).
 * @return {boolean} True for a reasoning deployment.
 */
function isReasoningDeployment(deploymentName) {
  return /(?:^|[^a-z0-9])(?:gpt-?5|o[1-9])(?:[^a-z0-9]|$)/i.test(String(deploymentName || ''));
}

/**
 * Azure OpenAI provider authenticated via Azure Key Vault.
 * @class
 * @extends {AIServiceBase}
 */
class AIOpenAIKv extends AIServiceBase {
  /**
   * Initializes the Azure OpenAI (Key Vault) service.
   *
   * @param {Object} options Configuration options.
   * @param {string} options.keyVaultUrl URL of the Azure Key Vault.
   * @param {string} options.tenantId App Registration #1 tenant ID.
   * @param {string} options.clientId App Registration #1 client ID.
   * @param {string} options.clientSecret App Registration #1 client secret.
   * @param {Object} [options.secretNames] Overrides for Key Vault secret names.
   * @param {string} [options.apiVersion] Azure OpenAI REST API version.
   * @param {string} [options.deployment] Fallback deployment name if the vault
   *     has no deployment-name secret.
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   * @throws {Error} When required Key Vault / App Registration #1 options are missing.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = 'This provider exposes Azure OpenAI authenticated through Azure Key Vault (two-stage App Registration flow).';
    this.settings.list = [
      {setting: 'keyVaultUrl', type: 'string', values: ['The Azure Key Vault URL']},
      {setting: 'apiVersion', type: 'string', values: ['2024-12-01-preview']},
      {setting: 'maxtokens', type: 'int', values: ['1000']},
      {setting: 'temperature', type: 'number', values: ['1']}
    ];

    // Generation defaults from the agent configuration (Agents screen). These
    // are stored on settings so prompt() honours them when a caller passes no
    // per-request override. Without this an agent's configured maxtokens /
    // temperature would be silently ignored and prompt() would always fall back
    // to its built-in defaults.
    if (options.maxtokens != null) this.settings.maxtokens = Number(options.maxtokens);
    if (options.temperature != null) this.settings.temperature = Number(options.temperature);

    const keyVaultUrl = options.keyVaultUrl || options.keyvaultUrl;
    if (!keyVaultUrl || !options.tenantId || !options.clientId || !options.clientSecret) {
      throw new Error(
        'Azure OpenAI Key Vault provider requires keyVaultUrl, tenantId, '
        + 'clientId and clientSecret (App Registration #1)'
      );
    }

    this.apiVersion_ = options.apiVersion || DEFAULT_AZURE_API_VERSION;

    // Merge secret-name overrides, ignoring null/undefined values so that a
    // caller passing a partially-populated object (e.g. unset env vars) does
    // not clobber the sensible defaults with undefined.
    const secretNames = { ...DEFAULT_SECRET_NAMES };
    for (const [key, value] of Object.entries(options.secretNames || {})) {
      if (value != null) {
        secretNames[key] = value;
      }
    }

    this.keyVaultConfig_ = {
      url: keyVaultUrl,
      tenantId: options.tenantId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      secretNames
    };

    // Resolved from Key Vault during initialization; an explicit deployment
    // acts as a fallback when the vault has no deployment-name secret.
    this.model_ = options.deployment || options.model || null;
    this.client_ = null;
    this.clientInit_ = null;
  }

  /**
   * Ensures an Azure OpenAI client is available, performing the Key Vault
   * two-stage authentication on first use. The work is memoised so concurrent
   * callers share a single initialization.
   *
   * @return {Promise<void>} Resolves once this.client_ is ready.
   * @private
   */
  async ensureClient_() {
    if (this.client_) {
      return;
    }
    if (!this.clientInit_) {
      this.clientInit_ = this.init_().catch((error) => {
        // Reset so a later call can retry instead of caching the failure.
        this.clientInit_ = null;
        throw error;
      });
    }
    await this.clientInit_;
  }

  /**
   * Performs the three-stage Key Vault authentication flow and creates the
   * Azure OpenAI client.
   *
   * @return {Promise<void>}
   * @throws {Error} When credential retrieval or client creation fails.
   * @private
   */
  async init_() {
    const cfg = this.keyVaultConfig_;

    // ---- STAGE 1: connect to Key Vault with App Registration #1 ----
    this.logger?.info(`[${this.constructor.name}] Stage 1: connecting to Key Vault`, {
      keyVaultUrl: cfg.url
    });
    const stage1Credential = new ClientSecretCredential(
      cfg.tenantId,
      cfg.clientId,
      cfg.clientSecret
    );
    const secretClient = new SecretClient(cfg.url, stage1Credential);

    // ---- STAGE 2: retrieve App Registration #2 credentials ----
    this.logger?.info(`[${this.constructor.name}] Stage 2: retrieving Azure OpenAI app credentials from Key Vault`);
    const credentials = await this.retrieveCredentials_(secretClient);

    // ---- STAGE 3: connect to Azure OpenAI with App Registration #2 ----
    this.logger?.info(`[${this.constructor.name}] Stage 3: connecting to Azure OpenAI`, {
      endpoint: credentials.endpoint,
      deploymentName: credentials.deploymentName
    });
    this.client_ = this.createOpenAiClient_(credentials);
    this.model_ = credentials.deploymentName;

    this.logger?.info(`[${this.constructor.name}] Azure OpenAI client ready`, {
      deploymentName: credentials.deploymentName,
      apiVersion: this.apiVersion_
    });
  }

  /**
   * STAGE 2: retrieves App Registration #2 credentials from Key Vault.
   *
   * @param {SecretClient} secretClient Key Vault secret client (Stage 1).
   * @return {Promise<Object>} { tenantId, clientId, clientSecret, endpoint, deploymentName }.
   * @throws {Error} When a required secret cannot be retrieved or no deployment resolves.
   * @private
   */
  async retrieveCredentials_(secretClient) {
    const names = this.keyVaultConfig_.secretNames;

    const getSecret = async (name) => {
      const secret = await secretClient.getSecret(name);
      return secret.value;
    };

    const credentials = {
      tenantId: await getSecret(names.tenantId),
      clientId: await getSecret(names.clientId),
      clientSecret: await getSecret(names.clientSecret),
      endpoint: await getSecret(names.endpoint),
      deploymentName: this.model_
    };

    try {
      credentials.deploymentName = await getSecret(names.deploymentName);
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Deployment name secret not found, using configured fallback`, {
        secretName: names.deploymentName,
        error: error.message
      });
    }

    if (!credentials.deploymentName) {
      throw new Error('Azure OpenAI deployment name could not be resolved from Key Vault or options');
    }

    return credentials;
  }

  /**
   * STAGE 3: creates an Azure OpenAI client using App Registration #2 and an
   * Azure AD bearer-token provider.
   *
   * @param {Object} credentials App Registration #2 credentials and endpoint.
   * @return {AzureOpenAI} Configured Azure OpenAI client.
   * @private
   */
  createOpenAiClient_(credentials) {
    const stage2Credential = new ClientSecretCredential(
      credentials.tenantId,
      credentials.clientId,
      credentials.clientSecret
    );

    // Azure AD token provider - obtains a bearer token for Azure OpenAI.
    const azureADTokenProvider = async () => {
      const token = await stage2Credential.getToken(AZURE_OPENAI_SCOPE);
      if (!token || !token.token) {
        throw new Error('Failed to obtain Azure AD token for Azure OpenAI');
      }
      return token.token;
    };

    return new AzureOpenAI({
      endpoint: credentials.endpoint,
      azureADTokenProvider,
      deployment: credentials.deploymentName,
      apiVersion: this.apiVersion_
    });
  }

  /**
   * Gets all provider settings.
   * @return {Promise<Object>} The settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Updates provider settings.
   * @param {Object} settings Settings to apply.
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
  }

  /**
   * Sends a prompt to Azure OpenAI, performing Key Vault authentication on
   * first use.
   *
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @param {number} [options.maxTokens] Maximum tokens in response (default: 1000).
   * @param {number} [options.temperature] Temperature for response (default: 0.7).
   * @return {Promise<Object>} Response with content and usage data.
   */
  async prompt(prompt, options = {}) {
    try {
      // Lazily complete the Key Vault authentication flow on first prompt.
      await this.ensureClient_();

      // Newer models (gpt-5 / o-series) renamed max_tokens -> max_completion_tokens
      // and only accept the default temperature.
      //
      // What is matched here is `this.model_`, which for this provider is the
      // Azure DEPLOYMENT name resolved from Key Vault — an arbitrary label that
      // usually carries the model family somewhere in the middle rather than at
      // the start ("krsa-poc-gpt-5-nano"). An anchored ^ test therefore reported
      // a gpt-5 reasoning deployment as a legacy model and handed it the 1000-token
      // budget below, which its hidden reasoning consumed entirely — returning
      // empty content on more than half of all calls, with no error to show for it.
      // Match the family anywhere in the name, on a non-alphanumeric boundary so
      // "gpt-4o" (not a reasoning model) still doesn't match the o-series branch.
      const isNewModel = isReasoningDeployment(this.model_);

      // Reasoning models spend part of the completion budget on hidden reasoning
      // tokens, so a 1000-token cap is frequently consumed entirely by reasoning
      // and returns empty content. Give them a much larger default when neither
      // the caller nor the agent configuration set an explicit budget.
      const defaultMaxTokens = isNewModel ? 16000 : 1000;
      const maxTokens = options.maxTokens || this.settings.maxtokens || defaultMaxTokens;
      const temperature = options.temperature || this.settings.temperature || 1;

      const params = {
        model: this.model_,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };
      if (isNewModel) {
        params.max_completion_tokens = maxTokens;
      } else {
        params.max_completion_tokens = maxTokens;
        params.temperature = temperature;
      }

      const response = await this.client_.chat.completions.create(params);

      const usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      };

      // Track usage and costs
      await this.trackUsage_(usage, this.model_, 'chatgpt');

      const result = {
        content: response.choices[0].message.content,
        usage,
        model: this.model_,
        provider: 'chatgpt'
      };

      this.emitPromptComplete_(prompt, result, options);

      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'chatgpt' });
      }
      throw error;
    }
  }
}

module.exports = AIOpenAIKv;
