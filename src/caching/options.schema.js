'use strict';
/** Caching provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, bool, any, apiProvider } = require('../shared/config/schemaTypes');

module.exports = {
  common: { properties: { maxSize: num('Maximum entries (memory)'), ttl: num('Default time to live in seconds') } },
  providers: {
    memory: { properties: {} },
    file: { properties: { cacheDir: str('Directory for cache files'), maxAnalyticsEntries: num('Analytics entries kept') } },
    redis: {
      open: true,
      properties: { redisurl: str('Redis host'), redisdurl: str('Redis host (old misspelling)'), poolSize: num('Connection pool size') },
      aliases: { redisUrl: 'redisurl' }
    },
    memcached: { open: true, properties: { memcachedurl: str('Memcached host:port') }, aliases: { memcachedUrl: 'memcachedurl' } },
    aws: {
      open: true,
      properties: {
        elasticacheEndpoint: str('ElastiCache endpoint'), elasticachePort: num('ElastiCache port'), region: str('AWS region'),
        authToken: str('Redis AUTH token'), tls: any('TLS settings'), clusterTimeout: num('Cluster timeout in ms'),
        poolSize: num('Pool size'), redisdurl: str('Redis host')
      }
    },
    azure: {
      open: true,
      properties: {
        connectionString: str('Azure Cache connection string'), hostname: str('Host name'), port: num('Port'),
        accessKey: str('Access key'), ssl: bool('Use TLS'), tls: any('TLS settings'), tier: str('Tier'),
        resourceGroup: str('Resource group'), resourceName: str('Resource name'), poolSize: num('Pool size')
      }
    },
    gcp: {
      open: true,
      properties: {
        host: str('Memorystore host'), port: num('Port'), projectId: str('Project id'), region: str('Region'),
        instanceId: str('Instance id'), authToken: str('AUTH token'), enableAuth: bool('Use AUTH'), tier: str('Tier'),
        memorySizeGb: num('Memory size'), network: str('Network'), poolSize: num('Pool size')
      }
    },
    api: apiProvider
  }
};
