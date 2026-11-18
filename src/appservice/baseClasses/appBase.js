/**
 * @fileoverview NooblyJS Core - Application Service Base Class
 * Base class for all custom service implementations in the NooblyJS Core framework.
 * Provides common initialization patterns, Express app integration, and event emission capabilities.
 *
 * This class is designed to be extended by:
 * - appServiceBase (custom services)
 * - appRouteBase (route handlers)
 * - appViewBase (view renderers)
 * - appWorkerBase (background workers)
 * - appDataBase (data layer implementations)
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Base class for application services in NooblyJS Core.
 * Provides foundational properties and initialization for all service types.
 * This is an abstract base class meant to be extended by other classes.
 *
 * @class appBase
 * @abstract
 */
class appBase {

  /**
   * Creates a new appBase instance.
   *
   * @param {string} type - The service type identifier (e.g., 'custom-auth', 'custom-api')
   * @param {Object} options - Service configuration options
   * @param {Express} options['express-app'] - Express application instance for route registration
   * @param {Object} [options.dependencies] - Injected service dependencies (logging, caching, etc.)
   * @param {string} [options.instanceName='default'] - Unique identifier for this service instance
   * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
   *
   * @example
   * // Extending appBase for a custom service
   * class CustomAuthService extends appBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *     this.authProvider = options.authProvider || 'oauth';
   *   }
   * }
   *
   * @example
   * // Using a service that extends appBase
   * const customService = new CustomAuthService('oauth', {
   *   'express-app': app,
   *   dependencies: { logging },
   *   instanceName: 'main-auth'
   * }, eventEmitter);
   */
  constructor(type, options, eventEmitter) {
    /**
     * Express application instance for route registration
     * @type {Express}
     * @protected
     */
    this.app = options['express-app'];

    /**
     * Service configuration options
     * @type {Object}
     * @protected
     */
    this.options = options;

    /**
     * Global event emitter for service communication
     * @type {EventEmitter}
     * @protected
     */
    this.eventEmitter = eventEmitter;
  }
}

module.exports = appBase;