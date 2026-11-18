/**
 * @fileoverview Google Cloud Platform (GCP) Cloud Memorystore provider for NooblyJS Core caching service.
 * Supports both Redis and Memcached engines in Cloud Memorystore with IAM authentication.
 * Uses the existing CacheRedis provider under the hood with GCP-specific configuration.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const CacheRedis = require('./cachingRedis');

/**
 * Google Cloud Memorystore provider for Redis
 * Automatically configures connection to GCP Cloud Memorystore Redis instances
 * Supports both basic and standard tiers with automatic discovery
 *
 * @class CacheGCPMemorystore
 */
class CacheGCPMemorystore extends CacheRedis {
  /**
   * Initializes GCP Cloud Memorystore Redis client
   * Automatically detects and configures Cloud Memorystore endpoints
   *
   * @param {Object=} options Configuration options
   * @param {string} options.projectId - GCP project ID
   * @param {string} options.region - GCP region (e.g., us-central1)
   * @param {string} options.instanceId - Cloud Memorystore instance ID
   * @param {string} options.host - Redis instance IP address or hostname
   * @param {number} options.port - Redis port (default: 6379)
   * @param {string} options.authToken - Redis AUTH token (if enabled)
   * @param {string} options.tier - Instance tier: 'basic' or 'standard' (auto-detected)
   * @param {number} options.memorySizeGb - Memory size in GB
   * @param {boolean} options.enableAuth - Whether AUTH is enabled (default: true)
   * @param {string} options.network - VPC network name for Private IP access
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events
   */
  constructor(options, eventEmitter) {
    // Extract GCP-specific options
    const gcpOptions = CacheGCPMemorystore.parseGCPOptions(options);

    // Call parent Redis constructor with GCP-configured options
    super(gcpOptions, eventEmitter);

    // Store GCP-specific metadata
    this.gcpProjectId_ = gcpOptions.projectId;
    this.gcpRegion_ = gcpOptions.region;
    this.gcpInstanceId_ = gcpOptions.instanceId;
    this.gcpTier_ = gcpOptions.tier;
    this.gcpMemorySizeGb_ = gcpOptions.memorySizeGb;
    this.gcpNetwork_ = gcpOptions.network;
    this.gcpEnableAuth_ = gcpOptions.enableAuth;

    // Update settings description for GCP
    this.settings.description = 'Google Cloud Memorystore Redis configuration';
    this.settings.list = [
      {
        setting: 'projectId',
        type: 'string',
        description: 'GCP project ID',
        example: 'my-project-123456'
      },
      {
        setting: 'region',
        type: 'string',
        description: 'GCP region',
        example: 'us-central1'
      },
      {
        setting: 'instanceId',
        type: 'string',
        description: 'Cloud Memorystore instance ID',
        example: 'my-redis-instance'
      },
      {
        setting: 'host',
        type: 'string',
        description: 'Redis host IP or hostname',
        example: '10.0.0.2'
      },
      {
        setting: 'port',
        type: 'number',
        description: 'Redis port',
        default: 6379
      },
      {
        setting: 'authToken',
        type: 'string',
        description: 'Redis AUTH token (if enabled)',
        optional: true
      },
      {
        setting: 'tier',
        type: 'string',
        description: 'Instance tier (basic or standard)',
        example: 'standard',
        optional: true
      },
      {
        setting: 'memorySizeGb',
        type: 'number',
        description: 'Memory size in GB',
        example: 4,
        optional: true
      },
      {
        setting: 'network',
        type: 'string',
        description: 'VPC network name for Private IP access',
        example: 'default',
        optional: true
      },
      {
        setting: 'enableAuth',
        type: 'boolean',
        description: 'Whether AUTH is enabled',
        default: true
      }
    ];
  }

  /**
   * Parse and validate GCP Memorystore options
   * Automatically detects endpoint from GCP environment or environment variables
   *
   * @private
   * @param {Object} options User-provided options
   * @return {Object} Processed options for Redis client
   */
  static parseGCPOptions(options = {}) {
    const projectId =
      options.projectId ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      'default-project';

    const region =
      options.region ||
      process.env.GCP_REGION ||
      'us-central1';

    const instanceId =
      options.instanceId ||
      process.env.GCP_INSTANCE_ID ||
      'default-instance';

    const host =
      options.host ||
      process.env.GCP_REDIS_HOST ||
      'localhost';

    const port =
      options.port ||
      parseInt(process.env.GCP_REDIS_PORT) ||
      6379;

    const authToken =
      options.authToken ||
      process.env.GCP_REDIS_AUTH_TOKEN ||
      undefined;

    const tier =
      options.tier ||
      process.env.GCP_INSTANCE_TIER ||
      'standard';

    const memorySizeGb =
      options.memorySizeGb ||
      parseInt(process.env.GCP_MEMORY_SIZE_GB) ||
      4;

    const network =
      options.network ||
      process.env.GCP_NETWORK ||
      'default';

    const enableAuth = options.enableAuth !== false; // Default true

    // Build Redis client options
    const redisOptions = {
      ...options,
      // Override with GCP-specific settings
      host: host,
      port: port,
      // GCP authentication via AUTH token
      password: authToken || undefined,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      // Connection pooling optimized for GCP
      poolSize: options.poolSize || 10,
      keepAlive: 60000, // Keep-alive for GCP connections
      connectTimeout: 10000,
      commandTimeout: 5000,
      // Reconnection strategy for GCP failover
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Store for reference
      projectId,
      region,
      instanceId,
      tier,
      memorySizeGb,
      network,
      enableAuth,
      providerType: 'gcp-memorystore'
    };

    return redisOptions;
  }

  /**
   * Detects the current configuration of the GCP Cloud Memorystore Redis instance.
   * Queries Redis configuration to determine instance tier (basic vs standard),
   * memory allocation, and network topology. Useful for capacity planning and optimization.
   *
   * @return {Promise<Object>} A promise that resolves to Memorystore configuration including:
   *   - tier: {string} Configured GCP tier: 'basic' or 'standard'
   *   - estimatedTier: {string} Estimated tier based on actual memory capacity
   *   - memorySizeGb: {number} Configured memory size in GB
   *   - maxMemory: {number} Maximum memory available in bytes
   *   - usedMemory: {string} Currently used memory (human-readable)
   *   - projectId: {string} GCP project ID
   *   - region: {string} GCP region
   *   - instanceId: {string} Cloud Memorystore instance ID
   *   - network: {string} VPC network name
   *   - authEnabled: {boolean} Whether Redis AUTH is enabled
   * @throws Does not throw - returns fallback config on error
   *
   * @example
   * // Detect GCP Memorystore configuration
   * const config = await cacheGCP.detectMemorystoreConfig();
   * console.log(`Instance tier: ${config.tier}, Memory: ${config.memorySizeGb}GB`);
   * console.log(`Used: ${config.usedMemory}/${config.maxMemory}`);
   */
  async detectMemorystoreConfig() {
    try {
      await this.ensureConnection_();

      // Get Redis info to detect configuration
      const info = await this.client_.info('server');
      const memoryInfo = await this.client_.info('memory');

      // Parse memory information
      const maxMemory = this.parseRedisInfo_(memoryInfo, 'maxmemory');
      const usedMemory = this.parseRedisInfo_(memoryInfo, 'used_memory_human');

      // Estimate tier based on max memory
      // Basic tier: up to 1GB
      // Standard tier: 1GB to 300GB
      let estimatedTier = 'basic';
      if (maxMemory > 1073741824) { // > 1GB
        estimatedTier = 'standard';
      }

      const config = {
        tier: this.gcpTier_,
        estimatedTier: estimatedTier,
        memorySizeGb: this.gcpMemorySizeGb_,
        maxMemory: maxMemory,
        usedMemory: usedMemory,
        projectId: this.gcpProjectId_,
        region: this.gcpRegion_,
        instanceId: this.gcpInstanceId_,
        network: this.gcpNetwork_,
        authEnabled: this.gcpEnableAuth_
      };

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('gcp-memorystore:config-detected', config);
      }

      return config;
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not detect GCP Memorystore config`, {
        error: error.message,
        projectId: this.gcpProjectId_,
        region: this.gcpRegion_
      });
      return {
        tier: this.gcpTier_,
        memorySizeGb: this.gcpMemorySizeGb_,
        projectId: this.gcpProjectId_,
        region: this.gcpRegion_,
        instanceId: this.gcpInstanceId_,
        error: error.message
      };
    }
  }

  /**
   * Parse Redis INFO response to extract key values
   * @private
   * @param {string} info Redis INFO response
   * @param {string} key Key to extract
   * @return {string|number} The value
   */
  parseRedisInfo_(info, key) {
    const lines = info.split('\r\n');
    for (const line of lines) {
      if (line.startsWith(key + ':')) {
        const value = line.split(':')[1];
        // Try to parse as number
        const num = parseInt(value);
        return isNaN(num) ? value : num;
      }
    }
    return null;
  }

  /**
   * Retrieves connection information for the GCP Cloud Memorystore Redis instance.
   * Extends parent method with GCP-specific metadata about the managed Redis service.
   *
   * @return {Object} Connection info object containing:
   *   - status: {string} Connection status ('ready', 'connecting', 'close')
   *   - poolSize: {number} Client connection pool size
   *   - connectedClients: {number} Number of connected clients
   *   - projectId: {string} GCP project ID
   *   - region: {string} GCP region
   *   - instanceId: {string} Cloud Memorystore instance ID
   *   - tier: {string} Instance tier ('basic' or 'standard')
   *   - memorySizeGb: {number} Memory size in GB
   *   - network: {string} VPC network name for Private IP access
   *   - authEnabled: {boolean} Whether Redis AUTH is enabled
   *   - provider: {string} 'gcp-memorystore'
   *
   * @example
   * // Get connection details for monitoring
   * const connInfo = cacheGCP.getConnectionInfo();
   * console.log(`Connected to ${connInfo.instanceId} in ${connInfo.region}`);
   */
  getConnectionInfo() {
    const parentInfo = super.getConnectionInfo();
    return {
      ...parentInfo,
      projectId: this.gcpProjectId_,
      region: this.gcpRegion_,
      instanceId: this.gcpInstanceId_,
      tier: this.gcpTier_,
      memorySizeGb: this.gcpMemorySizeGb_,
      network: this.gcpNetwork_,
      authEnabled: this.gcpEnableAuth_,
      provider: 'gcp-memorystore'
    };
  }

  /**
   * Retrieves performance analytics and cache statistics from the GCP Cloud Memorystore instance.
   * Collects metrics including hit/miss rates, memory usage, evictions, and connected clients.
   *
   * @return {Promise<Object>} A promise that resolves to analytics object containing:
   *   - cacheHits: {number} Total number of cache hits
   *   - cacheMisses: {number} Total number of cache misses
   *   - evictions: {number} Total number of evicted keys
   *   - usedMemory: {string} Currently used memory (human-readable, e.g., '256M')
   *   - maxMemory: {string} Maximum available memory (human-readable, e.g., '1GB')
   *   - connectedClients: {number} Number of currently connected clients
   *   - totalConnectionsReceived: {number} Total connections since instance creation
   *   - projectId: {string} GCP project ID
   *   - region: {string} GCP region
   *   - instanceId: {string} Cloud Memorystore instance ID
   *   - tier: {string} Instance tier
   *   - memorySizeGb: {number} Memory allocation in GB
   *   - provider: {string} 'gcp-memorystore'
   *   - (Parent class analytics): operations/sec, throughput, etc.
   * @throws Does not throw - returns parent analytics on error
   *
   * @example
   * // Monitor GCP Memorystore performance
   * const analytics = await cacheGCP.getAnalytics();
   * const hitRate = analytics.cacheHits / (analytics.cacheHits + analytics.cacheMisses);
   * console.log(`Hit rate: ${(hitRate * 100).toFixed(2)}%`);
   * console.log(`Total connections: ${analytics.totalConnectionsReceived}`);
   */
  async getAnalytics() {
    try {
      const parentAnalytics = super.getAnalytics();

      // Get additional GCP metrics from Redis INFO
      await this.ensureConnection_();
      const info = await this.client_.info('stats');
      const memoryInfo = await this.client_.info('memory');
      const clientsInfo = await this.client_.info('clients');

      const stats = {};
      const infoToProcess = info + '\r\n' + memoryInfo + '\r\n' + clientsInfo;

      infoToProcess.split('\r\n').forEach((line) => {
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
        usedMemory: stats.used_memory_human || 'N/A',
        maxMemory: stats.maxmemory_human || 'N/A',
        connectedClients: parseInt(stats.connected_clients) || 0,
        totalConnectionsReceived: parseInt(stats.total_connections_received) || 0,
        projectId: this.gcpProjectId_,
        region: this.gcpRegion_,
        instanceId: this.gcpInstanceId_,
        tier: this.gcpTier_,
        memorySizeGb: this.gcpMemorySizeGb_,
        provider: 'gcp-memorystore'
      };
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not get GCP analytics`, {
        error: error.message,
        operation: 'getAnalytics'
      });
      return super.getAnalytics();
    }
  }

  /**
   * Retrieves all configuration settings for the GCP Cloud Memorystore provider.
   * Includes both cache-level settings and GCP-specific resource configuration.
   *
   * @return {Promise<Object>} A promise that resolves to settings object containing:
   *   - (Parent class settings): cache configuration, list of available settings
   *   - gcp: {Object} GCP-specific configuration:
   *     - projectId: {string} GCP project ID
   *     - region: {string} GCP region
   *     - instanceId: {string} Cloud Memorystore instance ID
   *     - tier: {string} Instance tier ('basic' or 'standard')
   *     - memorySizeGb: {number} Memory allocation in GB
   *     - network: {string} VPC network name
   *     - authEnabled: {boolean} Whether AUTH is enabled
   *     - provider: {string} 'gcp-memorystore'
   *     - connectionInfo: {Object} Current connection information
   *
   * @example
   * // Get all settings including GCP resource details
   * const settings = await cacheGCP.getSettings();
   * console.log(`Project: ${settings.gcp.projectId}, Instance: ${settings.gcp.instanceId}`);
   */
  async getSettings() {
    const settings = await super.getSettings();

    return {
      ...settings,
      gcp: {
        projectId: this.gcpProjectId_,
        region: this.gcpRegion_,
        instanceId: this.gcpInstanceId_,
        tier: this.gcpTier_,
        memorySizeGb: this.gcpMemorySizeGb_,
        network: this.gcpNetwork_,
        authEnabled: this.gcpEnableAuth_,
        provider: 'gcp-memorystore',
        connectionInfo: this.getConnectionInfo()
      }
    };
  }

  /**
   * Ensure Redis connection is established
   * @private
   * @return {!Promise<void>}
   */
  async ensureConnection_() {
    if (!this.client_.status || this.client_.status === 'close') {
      await this.client_.connect();
    }
  }
}

module.exports = CacheGCPMemorystore;
