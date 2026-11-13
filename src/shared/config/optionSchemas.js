/**
 * @fileoverview Option schemas for the most used services and providers
 * (feature 08). Keys are the names each provider reads. Canonical camelCase
 * names are accepted alongside the legacy lowercase ones, and the legacy
 * spelling is reported once.
 *
 * Services without an entry are not checked yet.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

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
  }
};

module.exports = schemas;
