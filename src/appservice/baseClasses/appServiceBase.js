/**
 * @fileoverview NooblyJS Core - Application Service Base Class
 * Base class for implementing custom application services in NooblyJS Core.
 * Extends appBase with URL path normalization for route registration.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const appBase = require('./appBase.js');

/**
 * Base class for custom application services.
 * Extends appBase to provide service-specific functionality with automatic URL path normalization.
 * Use this when implementing a custom service that needs to register routes and views.
 *
 * @class appServiceBase
 * @extends {appBase}
 */
class appServiceBase extends appBase {

  /**
   * Creates a new appServiceBase instance.
   * Automatically normalizes the baseUrl to ensure it ends with a forward slash.
   *
   * @param {string} type - The service type identifier
   * @param {Object} options - Service configuration options
   * @param {Express} options['express-app'] - Express application instance
   * @param {string} options.baseUrl - Base URL path for all service routes (e.g., '/myservice')
   * @param {Object} [options.dependencies] - Injected service dependencies
   * @param {string} [options.instanceName='default'] - Unique identifier for this service instance
   * @param {EventEmitter} eventEmitter - Global event emitter for service communication
   *
   * @example
   * // Creating a custom service that extends appServiceBase
   * class WikiService extends appServiceBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *     // baseUrl will be '/wiki/' if '/wiki' is provided
   *     this.registerRoutes();
   *   }
   * }
   *
   * @example
   * // Instantiating the custom service
   * const wikiService = new WikiService('wiki', {
   *   'express-app': app,
   *   baseUrl: '/wiki',
   *   dependencies: { logging, dataservice }
   * }, eventEmitter);
   */
  constructor(type, options, eventEmitter) {
    super(type, options, eventEmitter);

    /**
     * Normalized base URL path that always ends with a forward slash
     * @type {string}
     * @protected
     */
    this.baseUrl = options.baseUrl;
    if (!options.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl + '/';
    }
  }
}

module.exports = appServiceBase;