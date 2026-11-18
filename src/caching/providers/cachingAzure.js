/**
 * @fileoverview Azure Cache for Redis provider for NooblyJS Core caching service.
 * Leverages Redis-based Azure Cache for distributed caching with managed authentication.
 * Uses the existing CacheRedis provider under the hood with Azure-specific configuration.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const CacheRedis = require('./cachingRedis');

/**
 * Azure Cache for Redis provider
 * Automatically configures connection to Azure Cache for Redis instances
 * Supports both Standard and Premium tiers with automatic tier detection
 *
 * @class CacheAzureRedis
 */
class CacheAzureRedis extends CacheRedis {
  /**
   * Initializes Azure Cache for Redis client
   * Automatically detects and configures Azure Redis endpoints
   *
   * @param {Object=} options Configuration options
   * @param {string} options.connectionString - Azure Redis connection string (e.g., myredis.redis.cache.windows.net:6379,password=XXX,ssl=True)
   * @param {string} options.hostname - Azure Redis hostname (e.g., myredis.redis.cache.windows.net)
   * @param {number} options.port - Azure Redis port (default: 6379 for non-SSL, 6380 for SSL)
   * @param {string} options.accessKey - Azure Redis access key (can be primary or secondary)
   * @param {string} options.resourceGroup - Azure resource group name
   * @param {string} options.resourceName - Azure Cache resource name
   * @param {string} options.tier - Azure tier: 'standard' or 'premium' (auto-detected)
   * @param {boolean} options.ssl - Enable SSL encryption (default: true)
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events
   */
  constructor(options, eventEmitter) {
    // Extract Azure-specific options
    const azureOptions = CacheAzureRedis.parseAzureOptions(options);

    // Call parent Redis constructor with Azure-configured options
    super(azureOptions, eventEmitter);

    // Store Azure-specific metadata
    this.azureHostname_ = azureOptions.hostname;
    this.azurePort_ = azureOptions.port;
    this.azureResourceGroup_ = azureOptions.resourceGroup;
    this.azureResourceName_ = azureOptions.resourceName;
    this.azureTier_ = azureOptions.tier;

    // Update settings description for Azure
    this.settings.description = 'Azure Cache for Redis configuration';
    this.settings.list = [
      {
        setting: 'connectionString',
        type: 'string',
        description: 'Azure Redis connection string',
        example: 'myredis.redis.cache.windows.net:6379,password=XXX,ssl=True',
        optional: true
      },
      {
        setting: 'hostname',
        type: 'string',
        description: 'Azure Redis hostname',
        example: 'myredis.redis.cache.windows.net'
      },
      {
        setting: 'port',
        type: 'number',
        description: 'Azure Redis port',
        default: 6380
      },
      {
        setting: 'accessKey',
        type: 'string',
        description: 'Azure Redis access key (primary or secondary)',
        optional: true
      },
      {
        setting: 'resourceGroup',
        type: 'string',
        description: 'Azure resource group name',
        example: 'my-resource-group'
      },
      {
        setting: 'resourceName',
        type: 'string',
        description: 'Azure Cache resource name',
        example: 'myredis'
      },
      {
        setting: 'tier',
        type: 'string',
        description: 'Azure tier (standard or premium)',
        example: 'premium',
        optional: true
      },
      {
        setting: 'ssl',
        type: 'boolean',
        description: 'Enable SSL encryption',
        default: true
      }
    ];
  }

  /**
   * Parse and validate Azure Redis options
   * Automatically detects endpoint from connection string or environment variables
   *
   * @private
   * @param {Object} options User-provided options
   * @return {Object} Processed options for Redis client
   */
  static parseAzureOptions(options = {}) {
    let hostname, port, password, tier;

    // Parse connection string if provided (format: host:port,password=XXX,ssl=True)
    if (options.connectionString) {
      const parts = options.connectionString.split(',');
      const hostPort = parts[0].split(':');
      hostname = hostPort[0];
      port = parseInt(hostPort[1]) || 6380;

      // Extract password from connection string
      parts.forEach(part => {
        const [key, value] = part.split('=');
        if (key === 'password') {
          password = value;
        }
      });
    } else {
      // Use individual options or environment variables
      hostname =
        options.hostname ||
        process.env.AZURE_REDIS_HOSTNAME ||
        'localhost';

      port =
        options.port ||
        parseInt(process.env.AZURE_REDIS_PORT) ||
        6380; // Azure defaults to 6380 for SSL

      password =
        options.accessKey ||
        process.env.AZURE_REDIS_ACCESS_KEY ||
        undefined;
    }

    // Determine tier from options or default to premium
    tier = options.tier || process.env.AZURE_REDIS_TIER || 'premium';

    // Validate tier
    if (!['standard', 'premium'].includes(tier.toLowerCase())) {
      tier = 'premium';
    }

    const resourceGroup = options.resourceGroup || process.env.AZURE_RESOURCE_GROUP || 'default';
    const resourceName = options.resourceName || process.env.AZURE_RESOURCE_NAME || 'default';

    // SSL is default for Azure (highly recommended)
    const ssl = options.ssl !== false;

    // Build Redis client options
    const redisOptions = {
      ...options,
      // Override with Azure-specific settings
      host: hostname,
      port: port,
      // Azure authentication
      password: password || undefined,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      // TLS encryption for in-transit security (required by Azure)
      tls: ssl ? {
        rejectUnauthorized: true,
        servername: hostname // Required for Azure SNI
      } : undefined,
      // Connection pooling optimized for Azure
      poolSize: options.poolSize || 10,
      keepAlive: 60000, // Keep-alive for Azure connections
      connectTimeout: 10000,
      commandTimeout: 5000,
      // Reconnection strategy for Azure failover
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Store for reference
      hostname,
      port,
      tier,
      resourceGroup,
      resourceName,
      providerType: 'azure-redis'
    };

    return redisOptions;
  }

  /**
   * Detects the tier and capacity of the Azure Cache for Redis instance.
   * Queries the Redis memory configuration to determine pricing tier (Standard or Premium)
   * and available capacity. Useful for capacity planning and cost optimization.
   *
   * @return {Promise<Object>} A promise that resolves to tier detection information including:
   *   - tier: {string} Configured Azure tier: 'standard' or 'premium'
   *   - estimatedTier: {string} Estimated tier based on memory capacity
   *   - maxMemory: {number} Maximum memory available in bytes
   *   - usedMemory: {string} Currently used memory (human-readable)
   *   - hostname: {string} Azure Redis hostname
   *   - resourceGroup: {string} Azure resource group name
   *   - resourceName: {string} Azure Cache resource name
   * @throws Does not throw - returns fallback tier info on error
   *
   * @example
   * // Detect Azure Cache tier to monitor capacity
   * const tierInfo = await cacheAzure.detectCacheTier();
   * console.log(`Tier: ${tierInfo.tier}, Used: ${tierInfo.usedMemory}`);
   * if (tierInfo.maxMemory < 1000000000) {
   *   console.warn('Cache nearing capacity, consider upgrading tier');
   * }
   */
  async detectCacheTier() {
    try {
      await this.ensureConnection_();

      // Get Redis info to detect configuration
      const info = await this.client_.info('server');
      const memoryInfo = await this.client_.info('memory');

      // Parse memory to estimate tier
      const maxMemory = this.parseRedisInfo_(memoryInfo, 'maxmemory');
      const usedMemory = this.parseRedisInfo_(memoryInfo, 'used_memory_human');

      // Estimate tier based on max memory
      let estimatedTier = 'standard'; // Default
      if (maxMemory > 53687091200) { // > 50GB
        estimatedTier = 'premium';
      }

      const tierInfo = {
        tier: this.azureTier_,
        estimatedTier: estimatedTier,
        maxMemory: maxMemory,
        usedMemory: usedMemory,
        hostname: this.azureHostname_,
        resourceGroup: this.azureResourceGroup_,
        resourceName: this.azureResourceName_
      };

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('azure-redis:tier-detected', tierInfo);
      }

      return tierInfo;
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not detect Azure Cache tier`, {
        error: error.message,
        hostname: this.azureHostname_,
        resourceGroup: this.azureResourceGroup_
      });
      return {
        tier: this.azureTier_,
        hostname: this.azureHostname_,
        resourceGroup: this.azureResourceGroup_,
        resourceName: this.azureResourceName_,
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
   * Retrieves connection information for the Azure Cache for Redis instance.
   * Extends parent method with Azure-specific metadata about the managed Redis service.
   *
   * @return {Object} Connection info object containing:
   *   - status: {string} Connection status ('ready', 'connecting', 'close')
   *   - poolSize: {number} Client connection pool size
   *   - connectedClients: {number} Number of connected clients
   *   - hostname: {string} Azure Redis hostname (*.redis.cache.windows.net)
   *   - port: {number} Cache port (6380 for SSL, 6379 for non-SSL)
   *   - resourceGroup: {string} Azure resource group containing the cache
   *   - resourceName: {string} Azure Cache resource name
   *   - tier: {string} Azure pricing tier ('standard' or 'premium')
   *   - provider: {string} 'azure-redis'
   *   - ssl: {boolean} Whether SSL/TLS encryption is enabled (always true for managed)
   *
   * @example
   * // Get connection details for diagnostics
   * const connInfo = cacheAzure.getConnectionInfo();
   * console.log(`Connected to ${connInfo.resourceName} tier: ${connInfo.tier}`);
   */
  getConnectionInfo() {
    const parentInfo = super.getConnectionInfo();
    return {
      ...parentInfo,
      hostname: this.azureHostname_,
      port: this.azurePort_,
      resourceGroup: this.azureResourceGroup_,
      resourceName: this.azureResourceName_,
      tier: this.azureTier_,
      provider: 'azure-redis',
      ssl: this.client_.options.tls ? true : false
    };
  }

  /**
   * Retrieves performance analytics and cache statistics from the Azure Cache for Redis instance.
   * Collects metrics including hit/miss rates, memory usage, evictions, and connected clients.
   *
   * @return {Promise<Object>} A promise that resolves to analytics object containing:
   *   - cacheHits: {number} Total number of cache hits
   *   - cacheMisses: {number} Total number of cache misses
   *   - evictions: {number} Total number of evicted keys
   *   - usedMemory: {string} Currently used memory (human-readable, e.g., '256M')
   *   - maxMemory: {string} Maximum available memory (human-readable, e.g., '1GB')
   *   - connectedClients: {number} Number of currently connected clients
   *   - hostname: {string} Azure Redis hostname
   *   - resourceGroup: {string} Azure resource group
   *   - resourceName: {string} Azure Cache resource name
   *   - tier: {string} Azure pricing tier
   *   - provider: {string} 'azure-redis'
   *   - (Parent class analytics): connections, operations/sec, etc.
   * @throws Does not throw - returns parent analytics on error
   *
   * @example
   * // Monitor Azure Cache performance and capacity
   * const analytics = await cacheAzure.getAnalytics();
   * const hitRate = analytics.cacheHits / (analytics.cacheHits + analytics.cacheMisses);
   * console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
   * console.log(`Memory used: ${analytics.usedMemory}/${analytics.maxMemory}`);
   */
  async getAnalytics() {
    try {
      const parentAnalytics = super.getAnalytics();

      // Get additional Azure metrics from Redis INFO
      await this.ensureConnection_();
      const info = await this.client_.info('stats');
      const memoryInfo = await this.client_.info('memory');

      const stats = {};
      const infoToProcess = info + '\r\n' + memoryInfo;

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
        hostname: this.azureHostname_,
        resourceGroup: this.azureResourceGroup_,
        resourceName: this.azureResourceName_,
        tier: this.azureTier_,
        provider: 'azure-redis'
      };
    } catch (error) {
      this.logger?.warn(`[${this.constructor.name}] Could not get Azure analytics`, {
        error: error.message,
        operation: 'getAnalytics'
      });
      return super.getAnalytics();
    }
  }

  /**
   * Retrieves all configuration settings for the Azure Cache for Redis provider.
   * Includes both cache-level settings and Azure-specific resource configuration.
   *
   * @return {Promise<Object>} A promise that resolves to settings object containing:
   *   - (Parent class settings): cache configuration, list of available settings
   *   - azure: {Object} Azure-specific configuration:
   *     - hostname: {string} Azure Redis hostname (*.redis.cache.windows.net)
   *     - port: {number} Cache port
   *     - resourceGroup: {string} Azure resource group name
   *     - resourceName: {string} Azure Cache resource name
   *     - tier: {string} Pricing tier ('standard' or 'premium')
   *     - provider: {string} 'azure-redis'
   *     - ssl: {boolean} SSL/TLS encryption status
   *     - connectionInfo: {Object} Current connection information
   *
   * @example
   * // Get all settings including Azure resource details
   * const settings = await cacheAzure.getSettings();
   * console.log(`Resource: ${settings.azure.resourceName} in ${settings.azure.resourceGroup}`);
   */
  async getSettings() {
    const settings = await super.getSettings();

    return {
      ...settings,
      azure: {
        hostname: this.azureHostname_,
        port: this.azurePort_,
        resourceGroup: this.azureResourceGroup_,
        resourceName: this.azureResourceName_,
        tier: this.azureTier_,
        provider: 'azure-redis',
        ssl: this.client_.options.tls ? true : false,
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

module.exports = CacheAzureRedis;
