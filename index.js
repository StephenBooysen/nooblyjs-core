/**
 * @fileoverview NooblyJS Core - Service Registry
 * A powerful set of modular Node.js backend services with singleton pattern.
 */

const EventEmitter = require('events');
const express = require('express');
const path = require('path');
const {
  createApiKeyAuthMiddleware,
  generateApiKey,
} = require('./src/middleware/apiKeyAuth');

class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.initialized = false;
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Initializes the service registry with an Express app
   * @param {Object} expressApp - Express application instance
   * @param {Object} eventEmitter - EventEmitter instance
   * @param {Object} globalOptions - Global configuration options
   */
  initialize(expressApp, eventEmitter, globalOptions = {}) {
    if (this.initialized) {
      return this;
    }

    this.expressApp = expressApp;
    this.eventEmitter = eventEmitter;
    this.globalOptions = {
      'express-app': expressApp,
      ...globalOptions,
    };

    // Setup API key authentication if configured
    if (globalOptions.apiKeys && globalOptions.apiKeys.length > 0) {
      this.authMiddleware = createApiKeyAuthMiddleware(
        {
          apiKeys: globalOptions.apiKeys,
          requireApiKey: globalOptions.requireApiKey !== false,
          excludePaths: globalOptions.excludePaths || [
            '/services/*/status',
            '/services/',
            '/services/*/views/*',
          ],
        },
        this.eventEmitter,
      );

      // Store auth config for services to use
      this.globalOptions.authMiddleware = this.authMiddleware;

      // Log API key authentication setup
      this.eventEmitter.emit('api-auth-setup', {
        message: 'API key authentication enabled',
        keyCount: globalOptions.apiKeys.length,
        requireApiKey: globalOptions.requireApiKey !== false,
      });
    }

    // Serve static files from the views directory for caching service
    expressApp.use(
      '/services/',
      express.static(path.join(__dirname, 'src/views')),
    );

    // Serve the service registry landing page
    this.expressApp.get('/services/', (req, res) => {
      res.sendFile(path.join(__dirname, 'src/views', 'index.html'));
    });

    // Serve the service registry landing page
    this.expressApp.get('/services/documentation', (req, res) => {
      res.sendFile(path.join(__dirname, './jsdoc', 'index.html'));
    });

    this.initialized = true;
    return this;
  }

  /**
   * Gets or creates a service instance (singleton pattern)
   * @param {string} serviceName - Name of the service
   * @param {string} providerType - Type of provider to use
   * @param {Object} options - Service-specific options
   * @returns {Object} Service instance
   */
  getService(serviceName, providerType = 'memory', options = {}) {
    if (!this.initialized) {
      throw new Error(
        'ServiceRegistry must be initialized before getting services',
      );
    }

    const serviceKey = `${serviceName}:${providerType}`;

    if (this.services.has(serviceKey)) {
      return this.services.get(serviceKey);
    }

    const mergedOptions = {
      ...this.globalOptions,
      ...options,
    };

    let service;
    try {
      const serviceFactory = require(`${__dirname}/src/${serviceName}`);
      service = serviceFactory(providerType, mergedOptions, this.eventEmitter);
    } catch (error) {
      throw new Error(
        `Failed to create service '${serviceName}' with provider '${providerType}': ${error.message}`,
      );
    }

    this.services.set(serviceKey, service);
    return service;
  }

  /**
   * Get the caching service
   * @param {string} providerType - 'memory', 'redis', or 'memcached'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Cache service instance
   */
  cache(providerType = 'memory', options = {}) {
    return this.getService('caching', providerType, options);
  }

  /**
   * Get the logging service
   * @param {string} providerType - 'console' or 'file'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Logger service instance
   */
  logger(providerType = 'console', options = {}) {
    return this.getService('logging', providerType, options);
  }

  /**
   * Get the data serving service
   * @param {string} providerType - 'memory', 'simpledb', 'file', 'mongodb', or 'documentdb'
   * @param {Object} options - Provider-specific options
   * @param {string} options.connectionString - MongoDB/DocumentDB connection string (for mongodb/documentdb provider)
   * @param {string} options.database - Database name (for mongodb/documentdb provider)
   * @param {string} options.host - DocumentDB host (for documentdb provider, defaults to '127.0.0.1')
   * @param {number} options.port - DocumentDB port (for documentdb provider, defaults to 10260)
   * @param {string} options.username - Username for authentication (for documentdb provider)
   * @param {string} options.password - Password for authentication (for documentdb provider)
   * @param {boolean} options.ssl - Enable SSL connection (for documentdb provider)
   * @returns {Object} DataServe service instance
   */
  dataServe(providerType = 'memory', options = {}) {
    return this.getService('dataserve', providerType, options);
  }

  /**
   * Get the filing service
   * @param {string} providerType - 'local', 'ftp', 's3', 'git', or 'sync'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Filing service instance
   */
  filing(providerType = 'local', options = {}) {
    return this.getService('filing', providerType, options);
  }

  /**
   * Get the filer service (alias for filing service)
   * @param {string} providerType - 'local', 'ftp', 's3', 'git', or 'sync'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Filer service instance
   */
  filer(providerType = 'local', options = {}) {
    return this.getService('filing', providerType, options);
  }

  /**
   * Get the measuring service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Measuring service instance
   */
  measuring(providerType = 'memory', options = {}) {
    return this.getService('measuring', providerType, options);
  }

  /**
   * Get the notifying service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Notifying service instance
   */
  notifying(providerType = 'memory', options = {}) {
    return this.getService('notifying', providerType, options);
  }

  /**
   * Get the queueing service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Queue service instance
   */
  queue(providerType = 'memory', options = {}) {
    return this.getService('queueing', providerType, options);
  }

  /**
   * Get the scheduling service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Scheduling service instance
   */
  scheduling(providerType = 'memory', options = {}) {
    return this.getService('scheduling', providerType, options);
  }

  /**
   * Get the searching service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Searching service instance
   */
  searching(providerType = 'memory', options = {}) {
    return this.getService('searching', providerType, options);
  }

  /**
   * Get the workflow service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Workflow service instance
   */
  workflow(providerType = 'memory', options = {}) {
    return this.getService('workflow', providerType, options);
  }

  /**
   * Get the working service
   * @param {string} providerType - 'memory'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Working service instance
   */
  working(providerType = 'memory', options = {}) {
    return this.getService('working', providerType, options);
  }

  /**
   * Get the AI service
   * @param {string} providerType - 'claude', 'chatgpt', or 'ollama'
   * @param {Object} options - Provider-specific options
   * @param {string} options.apiKey - API key for the provider (required for claude/chatgpt)
   * @param {string} options.model - Model to use (optional)
   * @returns {Object} AI service instance
   */
  aiservice(providerType = 'claude', options = {}) {
    return this.getService('aiservice', providerType, options);
  }

  /**
   * Get the event emitter for inter-service communication
   * @returns {EventEmitter} The global event emitter
   */
  getEventEmitter() {
    return this.eventEmitter;
  }

  /**
   * Lists all initialized services
   * @returns {Array} Array of service keys
   */
  listServices() {
    return Array.from(this.services.keys());
  }

  /**
   * Generate a new API key
   * @param {number} length - Length of the API key (default: 32)
   * @returns {string} Generated API key
   */
  generateApiKey(length = 32) {
    return generateApiKey(length);
  }

  /**
   * Clears all service instances (useful for testing)
   */
  reset() {
    this.services.clear();
    this.initialized = false;
  }
}

// Export singleton instance
const serviceRegistry = new ServiceRegistry();

module.exports = serviceRegistry;
