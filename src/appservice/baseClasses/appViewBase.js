/**
 * @fileoverview NooblyJS Core - View Renderer Base Class
 * Base class for implementing view rendering and static file serving in NooblyJS Core.
 * Provides integration with Express view engines and static file middleware.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const appBase = require('./appBase.js');

/**
 * Base class for custom view renderers and static file serving.
 * Extends appBase to provide view-specific functionality with automatic URL path normalization.
 * Use this when serving HTML templates, static files, or rendered views.
 *
 * @class appViewBase
 * @extends {appBase}
 */
class appViewBase extends appBase {

  /**
   * Creates a new appViewBase instance.
   * Automatically normalizes the baseUrl to ensure it ends with a forward slash.
   *
   * @param {string} type - The view handler type identifier
   * @param {Object} options - View configuration options
   * @param {Express} options['express-app'] - Express application instance for view registration
   * @param {string} options.baseUrl - Base URL path for serving views (e.g., '/views')
   * @param {Object} [options.dependencies] - Injected service dependencies
   * @param {string} [options.instanceName='default'] - Unique identifier for this view handler instance
   * @param {EventEmitter} eventEmitter - Global event emitter for view communication
   *
   * @example
   * // Creating custom views that extend appViewBase
   * class DashboardViews extends appViewBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *     this.setupViews();
   *   }
   *
   *   setupViews() {
   *     // Serve static files from public directory
   *     this.app.use(this.baseUrl, express.static('./public'));
   *
   *     // Serve dynamic HTML
   *     this.app.get(this.baseUrl + 'dashboard', this.renderDashboard.bind(this));
   *   }
   *
   *   async renderDashboard(req, res) {
   *     const data = { title: 'Dashboard', user: req.user };
   *     res.render('dashboard', data);
   *   }
   * }
   *
   * @example
   * // Instantiating the custom views
   * const dashboardViews = new DashboardViews('dashboard', {
   *   'express-app': app,
   *   baseUrl: '/dashboard',
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

module.exports = appViewBase;