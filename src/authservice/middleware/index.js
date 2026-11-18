'use strict';

/**
 * @fileoverview Authservice middleware exports
 * Consolidates middleware helpers that were previously located under src/middleware.
 */

const apiKey = require('./apiKey');
const services = require('./services');
const passport = require('./passport');
const authenticate = require('./authenticate');

module.exports = {
  ...apiKey,
  ...services,
  ...passport,
  ...authenticate
};
