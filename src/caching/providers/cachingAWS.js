/**
 * @fileoverview AWS ElastiCache provider for NooblyJS Core caching service.
 * Leverages Redis and Memcached ElastiCache clusters for distributed caching.
 * Uses the existing CacheRedis provider under the hood with AWS-specific configuration.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const CacheRedis = require('./cachingRedis');

/**
 * AWS ElastiCache provider for Redis
 * Automatically configures connection to AWS ElastiCache Redis clusters
 * Supports both single-node and cluster modes
 *
 * @class CacheAWSElastiCache
 */
class CacheAWSElastiCache extends CacheRedis {
  /**
   * Initializes AWS ElastiCache Redis client
   * Automatically detects and configures ElastiCache endpoints
   *
   * @param {Object=} options Configuration options
   * @param {string} options.elasticacheEndpoint - ElastiCache endpoint (e.g., my-cache.abc123.ng.0001.use1.cache.amazonaws.com)
   * @param {number} options.elasticachePort - ElastiCache port (default: 6379)
   * @param {string} options.region - AWS region (default: from AWS_REGION env var)
   * @param {string} options.authToken - AUTH token for encrypted clusters (optional)
   * @param {boolean} options.tls - Enable TLS encryption (default: true for clusters)
   * @param {number} options.clusterTimeout - Cluster topology refresh timeout (default: 30000ms)
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events
   */
  constructor(options, eventEmitter) {
    // Extract AWS-specific options
    const awsOptions = CacheAWSElastiCache.parseAwsOptions(options);

    // Call parent Redis constructor with AWS-configured options
    super(awsOptions, eventEmitter);

    // Store AWS-specific metadata
    this.awsRegion_ = awsOptions.region;
    this.elasticacheEndpoint_ = awsOptions.elasticacheEndpoint;
    this.elasticachePort_ = awsOptions.elasticachePort;

    // Update settings description for AWS
    this.settings.description = 'AWS ElastiCache Redis configuration';
    this.settings.list = [
      {
        setting: 'elasticacheEndpoint',
        type: 'string',
        description: 'ElastiCache endpoint address',
        example: 'my-cache.abc123.ng.0001.use1.cache.amazonaws.com'
      },
      {
        setting: 'elasticachePort',
        type: 'number',
        description: 'ElastiCache port',
        default: 6379
      },
      {
        setting: 'region',
        type: 'string',
        description: 'AWS region',
        example: 'us-east-1'
      },
      {
        setting: 'authToken',
        type: 'string',
        description: 'AUTH token for encrypted clusters (optional)',
        optional: true
      },
      {
        setting: 'tls',
        type: 'boolean',
        description: 'Enable TLS encryption',
        default: true
      }
    ];
  }

  /**
   * Parse and validate AWS ElastiCache options
   * Automatically detects endpoint from environment variables if not provided
   *
   * @private
   * @param {Object} options User-provided options
   * @return {Object} Processed options for Redis client
   */
  static parseAwsOptions(options = {}) {
    // Get endpoint from options or environment
    const elasticacheEndpoint =
      options.elasticacheEndpoint ||
      process.env.ELASTICACHE_ENDPOINT ||
      options.redisdurl ||
      'localhost';

    const elasticachePort = options.elasticachePort || parseInt(process.env.ELASTICACHE_PORT) || 6379;
    const region = options.region || process.env.AWS_REGION || 'us-east-1';
    const authToken = options.authToken || process.env.ELASTICACHE_AUTH_TOKEN;
    const tls = options.tls !== false; // Default to true for security

    // Build Redis client options
    const redisOptions = {
      ...options,
      // Override with ElastiCache-specific settings
      host: elasticacheEndpoint,
      port: elasticachePort,
      // AWS ElastiCache settings
      password: authToken || undefined, // Use as Redis password
      enableOfflineQueue: false, // ElastiCache doesn't support offline queuing
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      // TLS encryption for in-transit security
      tls: tls ? { rejectUnauthorized: true } : undefined,
      // Connection pooling optimized for AWS
      poolSize: options.poolSize || 10,
      keepAlive: 60000, // Keep-alive for ElastiCache connections
      // Cluster discovery timeout
      clusterOptions: {
        enableReadyCheck: true,
        redisOptions: {
          password: authToken || undefined
        }
      },
      // Store for reference
      region,
      elasticacheEndpoint,
      elasticachePort,
      providerType: 'aws-elasticache'
    };

    return redisOptions;
  }

  /**
   * Detects the cluster mode configuration of the AWS ElastiCache Redis instance.
   * Queries the Redis cluster information to determine if the instance is in cluster mode or single-node mode.
   * This is useful for optimizing configuration and understanding available partition strategies.
   *
   * @return {Promise<Object>} A promise that resolves to cluster detection information including:
   *   - mode: {string} Cluster mode: 'cluster' or 'single-node'
   *   - engine: {string} Cache engine: 'redis'
   *   - endpoint: {string} ElastiCache endpoint address
   *   - region: {string} AWS region
   *   - nodes: {number} Number of cluster nodes (if in cluster mode)
   * @throws Does not throw - returns fallback single-node config on error
   *
   * @example
   * // Detect if ElastiCache is using cluster mode
   * const clusterInfo = await cacheAWS.detectClusterMode();
   * if (clusterInfo.mode === 'cluster') {
   *   console.log(`ElastiCache cluster with ${clusterInfo.nodes} nodes`);
   * } else {
   *   console.log('Using single-node ElastiCache');
   * }
   */
  async detectClusterMode() {
    try {
      await this.ensureConnection_();

      // Get Redis info to detect cluster mode
      const info = await this.client_.info('cluster');

      const isClusterMode = info.includes('cluster_enabled:1');

      const clusterInfo = {
        mode: isClusterMode ? 'cluster' : 'single-node',
        engine: 'redis',
        endpoint: this.elasticacheEndpoint_,
        region: this.awsRegion_
      };

      if (isClusterMode) {
        // Reconfigure for cluster mode if needed
        const clusterNodes = await this.client_.cluster('nodes');
        clusterInfo.nodes = clusterNodes.split('\n').length;
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('elasticache:cluster-detected', clusterInfo);
      }

      return clusterInfo;
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not detect cluster mode`, {
        error: error.message,
        endpoint: this.elasticacheEndpoint_,
        region: this.awsRegion_
      });
      return {
        mode: 'single-node',
        engine: 'redis',
        endpoint: this.elasticacheEndpoint_,
        region: this.awsRegion_
      };
    }
  }

  /**
   * Retrieves connection information for the AWS ElastiCache instance.
   * Extends parent method with AWS-specific metadata about the ElastiCache cluster.
   *
   * @return {Object} Connection info object containing:
   *   - status: {string} Connection status ('ready', 'connecting', 'close')
   *   - poolSize: {number} Client connection pool size
   *   - connectedClients: {number} Number of connected clients
   *   - endpoint: {string} ElastiCache endpoint address
   *   - port: {number} Cache port (typically 6379)
   *   - region: {string} AWS region
   *   - provider: {string} 'aws-elasticache'
   *   - tls: {boolean} Whether TLS encryption is enabled
   *
   * @example
   * // Get connection details for monitoring
   * const connInfo = cacheAWS.getConnectionInfo();
   * console.log(`Connected to ${connInfo.endpoint} in ${connInfo.region}`);
   */
  getConnectionInfo() {
    const parentInfo = super.getConnectionInfo();
    return {
      ...parentInfo,
      endpoint: this.elasticacheEndpoint_,
      port: this.elasticachePort_,
      region: this.awsRegion_,
      provider: 'aws-elasticache',
      tls: this.client_.options.tls ? true : false
    };
  }

  /**
   * Retrieves performance analytics and cache statistics from the AWS ElastiCache instance.
   * Collects metrics including hit/miss rates, evictions, and other performance indicators.
   *
   * @return {Promise<Object>} A promise that resolves to analytics object containing:
   *   - cacheHits: {number} Total number of cache hits
   *   - cacheMisses: {number} Total number of cache misses
   *   - evictions: {number} Total number of evicted keys
   *   - endpoint: {string} ElastiCache endpoint
   *   - region: {string} AWS region
   *   - provider: {string} 'aws-elasticache'
   *   - (Parent class analytics): connections, memory usage, operations/sec, etc.
   * @throws Does not throw - returns parent analytics on error
   *
   * @example
   * // Monitor cache performance
   * const analytics = await cacheAWS.getAnalytics();
   * const hitRate = analytics.cacheHits / (analytics.cacheHits + analytics.cacheMisses);
   * console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
   * console.log(`Keys evicted: ${analytics.evictions}`);
   */
  async getAnalytics() {
    try {
      const parentAnalytics = super.getAnalytics();

      // Get additional AWS metrics from Redis INFO
      await this.ensureConnection_();
      const info = await this.client_.info('stats');

      const stats = {};
      info.split('\r\n').forEach((line) => {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key] = value;
        }
      });

      return {
        ...parentAnalytics,
        cacheHits: parseInt(stats.keyspace_hits) || 0,
        cacheMisses: parseInt(stats.keyspace_misses) || 0,
        evictions: parseInt(stats.evicted_keys) || 0,
        endpoint: this.elasticacheEndpoint_,
        region: this.awsRegion_,
        provider: 'aws-elasticache'
      };
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not get AWS analytics`, {
        error: error.message,
        operation: 'getAnalytics'
      });
      return super.getAnalytics();
    }
  }

  /**
   * Retrieves all configuration settings for the AWS ElastiCache provider.
   * Includes both cache-level settings and AWS-specific ElastiCache configuration.
   *
   * @return {Promise<Object>} A promise that resolves to settings object containing:
   *   - (Parent class settings): cache configuration, list of available settings
   *   - elasticache: {Object} AWS-specific configuration:
   *     - endpoint: {string} ElastiCache endpoint
   *     - port: {number} Cache port
   *     - region: {string} AWS region
   *     - provider: {string} 'aws-elasticache'
   *     - connectionInfo: {Object} Current connection information
   *
   * @example
   * // Get all settings including AWS-specific config
   * const settings = await cacheAWS.getSettings();
   * console.log(`ElastiCache endpoint: ${settings.elasticache.endpoint}`);
   */
  async getSettings() {
    const settings = await super.getSettings();

    return {
      ...settings,
      elasticache: {
        endpoint: this.elasticacheEndpoint_,
        port: this.elasticachePort_,
        region: this.awsRegion_,
        provider: 'aws-elasticache',
        connectionInfo: this.getConnectionInfo()
      }
    };
  }
}

module.exports = CacheAWSElastiCache;
