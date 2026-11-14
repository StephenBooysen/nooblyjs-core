/**
 * @fileoverview Authentication service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving
 * capabilities for the authentication service. It registers static routes to serve
 * auth-related view files and templates through the Express application.
 *
 * @author NooblyJS
 * @version 1.0.0
 * @since 1.0.0
 * @module AuthViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers authentication service views with the Express application.
 * Sets up static file serving for auth-related view templates and assets.
 * This function integrates the authentication service views into the main Express
 * application by mounting static file middleware at the '/services/authservice' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} auth - The authentication service provider instance
 * @returns {void}
 */
module.exports = (options, _eventEmitter, _auth) => {
  if (options['express-app']) {
    const app = options['express-app'];

    // Serve static files for the auth service views
    app.use('/services/authservice/views',
      express.static(path.join(__dirname)));

    // The dashboard's own scripts, loaded relative to /services/authservice/
    // (strict CSP: no inline scripts). Behind the login gate like the page.
    app.use('/services/authservice/js', express.static(path.join(__dirname, 'js')));

    // Serve the main auth interface at the service root
    app.get('/services/authservice/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Serve login page
    app.get('/services/authservice/views/login.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'login.html'));
    });

    // Serve register page
    app.get('/services/authservice/views/register.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'register.html'));
    });

    // Serve invalid/insufficient privileges page
    app.get('/services/authservice/views/invalid.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'invalid.html'));
    });

    // Serve the user profile page (change password + API token management) at a
    // clean URL in addition to the static /views/profile.html path.
    app.get('/services/authservice/profile', (req, res) => {
      res.sendFile(path.join(__dirname, 'profile.html'));
    });

    // Serve the invitation redemption page at the clean URL used in
    // invitation links (e.g. /services/authservice/redeem-invitation?code=...).
    // The page reads the ?code= query string client-side.
    app.get('/services/authservice/redeem-invitation', (req, res) => {
      res.sendFile(path.join(__dirname, 'redeem-invitation.html'));
    });

  }
};