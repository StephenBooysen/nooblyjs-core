/**
 * @fileoverview Route utility functions for service instance resolution.
 * Provides reusable helpers for multi-instance service routing across services.
 * Centralizes the logic for resolving service instances by name while maintaining
 * fallback to default instances when named instances are not found.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * Gets the appropriate service instance based on instance name.
 * Falls back to the provided default service if no instance name is specified
 * or if the requested instance cannot be found in the ServiceRegistry.
 *
 * This function enables routes to support multiple named instances of the same service
 * without duplicating logic in each route file.
 *
 * @param {string} serviceName - Service type identifier (e.g., 'caching', 'queueing', 'logging')
 * @param {string} instanceName - Optional instance name for retrieving non-default instances
 * @param {Object} defaultService - Default service instance to return if no instance found
 * @param {Object} options - Configuration options object
 * @param {Object} [options.ServiceRegistry] - ServiceRegistry singleton for instance lookup
 * @param {string} [providerType='memory'] - Provider type for the service lookup
 * @return {Object} Service instance to use for the request
 *
 * @example
 * // Get default cache instance
 * const instance = getServiceInstance('caching', undefined, defaultCache, options);
 *
 * @example
 * // Get named cache instance
 * const instance = getServiceInstance('caching', 'session-cache', defaultCache, options, 'redis');
 *
 * @example
 * // Usage in route handler
 * app.get('/api/:instanceName/stats', (req, res) => {
 *   const service = getServiceInstance('caching', req.params.instanceName, cache, options);
 *   const stats = service.getStats();
 *   res.json(stats);
 * });
 */
function getServiceInstance(serviceName, instanceName, defaultService, options, providerType = 'memory') {
  // Return default if no instance name specified
  if (!instanceName || instanceName === 'default') {
    return defaultService;
  }

  // Try to get from service registry if available
  const ServiceRegistry = options.ServiceRegistry;
  if (ServiceRegistry) {
    const instance = ServiceRegistry.getServiceInstance(serviceName, providerType, instanceName);
    if (instance) {
      return instance;
    }
  }

  // If not found, fall back to default
  return defaultService;
}

module.exports = {
  getServiceInstance
};
