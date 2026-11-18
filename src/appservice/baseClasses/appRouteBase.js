/**
 * @fileoverview NooblyJS Core - Application Route Handler Base Class
 * Base class for implementing custom route handlers in NooblyJS Core.
 * Provides integration with Express routing and URL path normalization.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const appBase = require('./appBase.js');

/**
 * Base class for custom route handlers.
 * Extends appBase to provide route-specific functionality with automatic URL path normalization.
 * Use this when implementing custom Express routes for your application.
 *
 * @class appRouteBase
 * @extends {appBase}
 */
class appRouteBase extends appBase {

  /**
   * Creates a new appRouteBase instance.
   * Automatically normalizes the baseUrl to ensure it ends with a forward slash.
   *
   * @param {string} type - The route handler type identifier
   * @param {Object} options - Route configuration options
   * @param {Express} options['express-app'] - Express application instance for route registration
   * @param {string} options.baseUrl - Base URL path for all routes (e.g., '/api')
   * @param {Object} [options.dependencies] - Injected service dependencies
   * @param {string} [options.instanceName='default'] - Unique identifier for this route handler instance
   * @param {EventEmitter} eventEmitter - Global event emitter for route communication
   *
   * @example
   * // Creating custom routes that extend appRouteBase
   * class UserRoutes extends appRouteBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *     this.setupRoutes();
   *   }
   *
   *   setupRoutes() {
   *     this.app.get(this.baseUrl + 'users', this.listUsers.bind(this));
   *     this.app.post(this.baseUrl + 'users', this.createUser.bind(this));
   *   }
   *
   *   async listUsers(req, res) {
   *     res.json({ users: [] });
   *   }
   *
   *   async createUser(req, res) {
   *     res.json({ created: true });
   *   }
   * }
   *
   * @example
   * // Instantiating the custom routes
   * const userRoutes = new UserRoutes('user-api', {
   *   'express-app': app,
   *   baseUrl: '/api',
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

module.exports = appRouteBase;