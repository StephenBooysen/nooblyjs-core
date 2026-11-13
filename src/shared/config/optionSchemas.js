/**
 * @fileoverview Option schemas for the most used services and providers
 * (feature 08). Keys are the names each provider reads. Canonical camelCase
 * names are accepted alongside the legacy lowercase ones, and the legacy
 * spelling is reported once.
 *
 * Every service is covered for its most used providers. Searching is checked
 * only for its remote (`api`) provider, because its in-process providers take
 * many per-call options. Providers without an entry are not checked.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

/** Options of every `*Api.js` provider, which proxies to a remote instance. */
const API_PROVIDER = {
  keys: {
    api: { type: 'string' },
    apiRoot: { type: 'string' },
    apiUrl: { type: 'string' },
    url: { type: 'string' },
    apiKey: { type: 'string' },
    apikey: { type: 'string', legacyOf: 'apiKey' },
    timeout: { type: 'number' },
    retryLimit: { type: 'number' }
  }
};

/** Options every authentication provider reads (authBase.js and the routes). */
const AUTH_BASE_KEYS = {
  dataDir: { type: 'string' },
  sessionIdleTimeoutMs: { type: 'object' },
  invitations: { type: 'object' },
  loginSuccessRedirectUrl: { type: 'string' },
  brandingConfig: { type: 'object' },
  ssoSecret: { type: 'string' },
  ssoAllowedReturnUrls: { type: 'array' },
  createDefaultAdmin: { type: 'boolean' }
};

/** OAuth options shared by the Google and Azure providers. */
const OAUTH_KEYS = {
  clientID: { type: 'string' },
  clientSecret: { type: 'string' },
  callbackURL: { type: 'string' }
};

/** Options the shared-module AI providers read (provider/aiCommon.js). */
const AI_COMMON = {
  keys: {
    model: { type: 'string' },
    apiKey: { type: 'string' },
    baseUrl: { type: 'string' },
    budgets: { type: 'object' },
    embeddings: { type: 'object' },
    script: { type: 'array' },
    legacy: { type: 'boolean' }
  }
};

/** Options the legacy AI providers read in their constructors (aibase.js and each provider). */
const AI_LEGACY_BASE = {
  model: { type: 'string' },
  apiKey: { type: 'string' },
  apikey: { type: 'string', legacyOf: 'apiKey' },
  maxTokens: { type: 'number' },
  maxtokens: { type: 'number', legacyOf: 'maxTokens' },
  temperature: { type: 'number' },
  tokensStorePath: { type: 'string' },
  username: { type: 'string' },
  legacy: { type: 'boolean' }
};

const schemas = {
  logging: {
    file: {
      keys: {
        logDir: { type: 'string' },
        filename: { type: 'string' },
        minLogLevel: { type: 'string' },
        maxSize: { type: 'number' },
        maxFiles: { type: 'number' },
        rotatePeriod: { type: 'string' }
      }
    },
    api: {
      keys: {
        api: { type: 'string' },
        apiRoot: { type: 'string' },
        apiKey: { type: 'string' },
        apikey: { type: 'string', legacyOf: 'apiKey' },
        minLogLevel: { type: 'string' },
        timeout: { type: 'number' }
      }
    }
  },

  caching: {
    redis: {
      keys: {
        redisUrl: { type: 'string', maps: 'redisurl' },
        redisurl: { type: 'string', legacyOf: 'redisUrl' },
        poolSize: { type: 'number' }
      }
    },
    memcached: {
      keys: {
        memcachedurl: { type: 'string' }
      }
    }
  },

  queueing: {
    redis: {
      keys: {
        redisUrl: { type: 'string', maps: 'redisurl' },
        redisurl: { type: 'string', legacyOf: 'redisUrl' },
        redisPort: { type: 'number', maps: 'redisport' },
        redisport: { type: 'number', legacyOf: 'redisPort' },
        host: { type: 'string' },
        port: { type: 'number' },
        poolSize: { type: 'number' }
      }
    }
  },

  dataservice: {
    mongodb: {
      keys: {
        connectionString: { type: 'string' },
        database: { type: 'string' }
      }
    }
  },

  filing: {
    local: {
      keys: {
        baseDir: { type: 'string' },
        maxFileSize: { type: 'number' },
        allowedTypes: { type: 'string' }
      }
    },
    s3: {
      required: ['bucketName', 'region'],
      keys: {
        bucketName: { type: 'string' },
        region: { type: 'string' },
        accessKeyId: { type: 'string' },
        secretAccessKey: { type: 'string' },
        maxUploadSize: { type: 'number' }
      }
    }
  },

  authservice: {
    memory: { keys: { ...AUTH_BASE_KEYS } },
    file: { keys: { ...AUTH_BASE_KEYS } },
    'secure-email': { keys: { ...AUTH_BASE_KEYS } },
    passport: { keys: { ...AUTH_BASE_KEYS, passport: { type: 'object' } } },
    google: { required: ['clientID', 'clientSecret'], keys: { ...AUTH_BASE_KEYS, ...OAUTH_KEYS } },
    azure: {
      required: ['clientID', 'clientSecret', 'tenantID'],
      keys: {
        ...AUTH_BASE_KEYS,
        ...OAUTH_KEYS,
        tenantID: { type: 'string' },
        redirectUrl: { type: 'string' },
        baseUrl: { type: 'string' },
        scope: { type: 'any' },
        userStore: { type: 'object' },
        passport: { type: 'object' }
      }
    },
    api: API_PROVIDER
  },

  aiservice: {
    anthropic: AI_COMMON,
    'openai-compatible': AI_COMMON,
    bedrock: AI_COMMON,
    vertex: AI_COMMON,
    azure: AI_COMMON,
    mock: AI_COMMON,
    claude: { keys: { ...AI_LEGACY_BASE, ...AI_COMMON.keys } },
    openai: { keys: { ...AI_LEGACY_BASE, ...AI_COMMON.keys, endpoint: { type: 'string' }, apiVersion: { type: 'string' }, deployment: { type: 'string' } } },
    chatgpt: { keys: { ...AI_LEGACY_BASE, ...AI_COMMON.keys, endpoint: { type: 'string' }, apiVersion: { type: 'string' }, deployment: { type: 'string' } } },
    gemini: { keys: { ...AI_LEGACY_BASE, ...AI_COMMON.keys, endpoint: { type: 'string' }, apiVersion: { type: 'string' } } },
    ollama: { keys: { ...AI_LEGACY_BASE, ...AI_COMMON.keys, endpoint: { type: 'string' }, stream: { type: 'boolean' } } },
    'openai-kv': {
      keys: {
        ...AI_LEGACY_BASE,
        keyVaultUrl: { type: 'string' },
        keyvaultUrl: { type: 'string', legacyOf: 'keyVaultUrl' },
        tenantId: { type: 'string' },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
        secretNames: { type: 'object' },
        deployment: { type: 'string' },
        apiVersion: { type: 'string' }
      }
    },
    tensorflow: {
      keys: {
        modelPath: { type: 'string' },
        vocabSize: { type: 'number' },
        embeddingDim: { type: 'number' },
        lstmUnits: { type: 'number' },
        sequenceLength: { type: 'number' },
        epochs: { type: 'number' },
        batchSize: { type: 'number' },
        maxTokens: { type: 'number' },
        temperature: { type: 'number' },
        trainDebounceMs: { type: 'number' }
      }
    }
  },

  settings: {
    file: { keys: { filepath: { type: 'string' }, secret: { type: 'string' }, autosave: { type: 'boolean' }, maskSecrets: { type: 'boolean' } } },
    encrypted: { keys: { filepath: { type: 'string' }, secret: { type: 'string' }, autosave: { type: 'boolean' }, maskSecrets: { type: 'boolean' } } }
  },

  workflow: {
    memory: {
      keys: {
        state: { type: 'object' },
        maxExecutionsPerWorkflow: { type: 'number' },
        scheduleCatchUp: { type: 'boolean' },
        catchUpGraceMs: { type: 'number' },
        catchUpStaggerMs: { type: 'number' },
        autoStartScheduler: { type: 'boolean' }
      }
    },
    api: API_PROVIDER
  },

  scheduling: {
    memory: { keys: { maxConcurrentJobs: { type: 'number' }, jobTimeout: { type: 'number' }, retryAttempts: { type: 'number' }, maxRunsPerTask: { type: 'number' } } }
  },

  working: {
    memory: {
      keys: {
        activities: { type: 'object' },
        activitiesFolder: { type: 'string' },
        allowAbsolutePaths: { type: 'boolean' },
        callbackTimeout: { type: 'number' },
        maxQueueSize: { type: 'number' },
        maxThreads: { type: 'number' },
        originId: { type: 'string' },
        resourceLimits: { type: 'object' },
        workerTimeout: { type: 'number' }
      }
    },
    api: API_PROVIDER
  },

  notifying: {
    memory: { keys: { enableQueuing: { type: 'boolean' }, maxNotificationHistory: { type: 'number' }, maxSubscribers: { type: 'number' }, messageTimeout: { type: 'number' } } },
    api: API_PROVIDER
  },

  measuring: {
    memory: { keys: { aggregationInterval: { type: 'number' }, dataRetention: { type: 'number' }, metricsLimit: { type: 'number' } } },
    api: API_PROVIDER
  },

  searching: {
    api: API_PROVIDER
  }
};

// The default provider names map to the same classes as `memory`.
for (const service of ['scheduling', 'working', 'notifying', 'measuring']) {
  schemas[service].default = schemas[service].memory;
}

module.exports = schemas;
