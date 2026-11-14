/**
 * @fileoverview Notifying service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the notifying service. It registers static routes to serve
 * notifying-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module NotifyingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers notifying service views with the Express application.
 * Sets up static file serving for notifying-related view templates and assets.
 * This function integrates the notifying service views into the main Express
 * application by mounting static file middleware at the '/services/notifying' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} notifier - The notifying service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const notifyingViews = require('./src/notifying/views');
 * 
 * notifyingViews({
 *   'express-app': app
 * }, eventEmitter, notifyingService);
 */
module.exports = (options, eventEmitter, notifier) => {
  if (options['express-app']) {
    const app = options['express-app'];

    // The page's own scripts (strict CSP: no inline scripts). Only the js/
    // folder is served, so nothing else under /services/notifying is intercepted.
    app.use('/services/notifying/js', express.static(path.join(__dirname, 'js')));

    // Serve the notifying service view
    // Only serve index.html, not all static files (to avoid intercepting CSS/other assets)
    app.get('/services/notifying', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/services/notifying/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });
  }
};