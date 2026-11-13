/**
 * @fileoverview NooblyJS Core - Service Registry
 * This is the container of all the services. It manages the various dependancies of the services
 */
'use strict';

const EventEmitter = require('events');
const express = require('express');
const path = require('node:path');

// Retrieve the auth middleware
const {
  createApiKeyAuthMiddleware,
  createServicesAuthMiddleware,
  generateApiKey
} = require('./src/authservice/middleware');

// Implement monitoring
const systemMonitoring = require('./src/views/modules/monitoring');
const { sendSafeError } = require('./src/shared/utils/safeError');
const { assertServiceOptions } = require('./src/shared/utils/optionSchema');
const OPTION_SCHEMAS = require('./src/shared/config/optionSchemas');
const { createPermissionGate } = require('./src/authservice/middleware/permissionGate');
const { RouteDeclarations, findUndeclaredRoutes, listApiRoutes } = require('./src/authservice/modules/routeDeclarations');
const { buildOpenApiDocument, loadServiceDocuments, mountedBases } = require('./src/shared/utils/openapi');
const { mountMcp } = require('./src/mcp');
const { normalizeKeyEntries, findKeyEntry } = require('./src/authservice/modules/permissions');

const ensureArray = (value) => {
  if (Array.isArray(value)) {
    return value.slice();
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  return [];
};

class ServiceRegistry {

  constructor() {
    this.services = new Map();
    this.serviceDependencies = new Map();
    this.initialized = false;
    this.strictOptions = false;
    /** @type {boolean} strictAuth: undeclared /services/*\/api routes fail start-up and are refused (feature 19). */
    this.strictAuth = process.env.NODE_ENV === 'production';
    /** @type {RouteDeclarations} Permission declared for each built-in API route. */
    this.routeDeclarations = new RouteDeclarations();
    this.eventEmitter = new EventEmitter();
    this.dependenciesInitialized = false;
    // App-declared default provider/options per service. When set, dependency
    // injection uses these instead of the built-in defaults, so a provider
    // chosen once (e.g. queueing→activemq) is shared by every dependent service.
    this.defaultProviderConfig = new Map();
  }

  /**
   * Initializes the service registry with an Express app
   * @param {Object} expressApp - Express application instance
   * @param {Object} eventEmitter - EventEmitter instance
   * @param {Object} globalOptions - Global configuration options
   */
  initialize(expressApp, eventEmitter, globalOptions = {}) {

    // Prevent re-initialization
    if (this.initialized) {
      return this;
    }

    // Assign the express app
    this.expressApp = expressApp;

    // Assign the Event Emitter if its passed
    if (eventEmitter) {
      this.eventEmitter = eventEmitter;    
    } 

    const {
      security: incomingSecurityConfig = {},
      ...legacyOptions
    } = globalOptions;

    const apiKeyAuthConfig = {
      ...(incomingSecurityConfig.apiKeyAuth || {})
    };

    const servicesAuthConfig = {
      ...(incomingSecurityConfig.servicesAuth || {})
    };

    const apiKeys = ensureArray(
      apiKeyAuthConfig.apiKeys !== undefined
        ? apiKeyAuthConfig.apiKeys
        : legacyOptions.apiKeys
    );

    const requireApiKey =
      typeof apiKeyAuthConfig.requireApiKey === 'boolean'
        ? apiKeyAuthConfig.requireApiKey
        : typeof legacyOptions.requireApiKey === 'boolean'
          ? legacyOptions.requireApiKey
          : apiKeys.length > 0;

    const hasCustomExcludePaths =
      apiKeyAuthConfig.excludePaths !== undefined ||
      legacyOptions.excludePaths !== undefined;

    const excludePaths = hasCustomExcludePaths
      ? ensureArray(
          apiKeyAuthConfig.excludePaths !== undefined
            ? apiKeyAuthConfig.excludePaths
            : legacyOptions.excludePaths
        )
      : undefined;

    const requireServicesLogin =
      typeof servicesAuthConfig.requireLogin === 'boolean'
        ? servicesAuthConfig.requireLogin
        : true;

    const normalizedSecurityConfig = {
      ...incomingSecurityConfig,
      apiKeyAuth: {
        ...apiKeyAuthConfig,
        apiKeys,
        requireApiKey,
        excludePaths
      },
      servicesAuth: {
        ...servicesAuthConfig,
        requireLogin: requireServicesLogin
      }
    };

    // Assign the passed global options
    // strictOptions turns option warnings into errors (feature 08).
    this.strictOptions = Boolean(globalOptions.strictOptions);
    // strictAuth defaults on in production (feature 19); set security.strictAuth to override.
    this.strictAuth = typeof incomingSecurityConfig.strictAuth === 'boolean'
      ? incomingSecurityConfig.strictAuth
      : process.env.NODE_ENV === 'production';
    this.globalOptions = {
      'express-app': expressApp,
      ...legacyOptions,
      security: normalizedSecurityConfig
    };

    this.globalOptions.apiKeys = apiKeys;
    this.globalOptions.requireApiKey = requireApiKey;

    if (hasCustomExcludePaths) {
      this.globalOptions.excludePaths = excludePaths;
    } else {
      delete this.globalOptions.excludePaths;
    }

    this.securityConfig = normalizedSecurityConfig;

    // Initialize service dependencies
    this.initializeServiceDependencies();

    // Setup API key authentication if configured
    if (apiKeys.length > 0 || requireApiKey === false) {
      const middlewareOptions = {
        apiKeys,
        requireApiKey
      };

      if (excludePaths) {
        middlewareOptions.excludePaths = excludePaths;
      }

      // Late-bind the user-token validator: the authservice instance is created
      // later (by the host app), so resolve it per-request rather than at setup
      // time. This lets personal access tokens (dtk_) authenticate against any
      // /services/* endpoint just like a static API key, but as the owning user.
      middlewareOptions.validateApiToken = (rawToken) => {
        const auth = this.getAuthProviderForTokens_();
        if (!auth || typeof auth.validateApiToken !== 'function') {
          return null;
        }
        return auth.validateApiToken(rawToken);
      };

      // Late-bind the session-token validator so the data-plane API guard
      // accepts the same browser session credential the /services portal uses.
      // Dashboard fetch() calls carry an `authToken` session token (cookie /
      // Bearer / query) rather than a Passport login session or an API key;
      // without this the filing/logging/etc. dashboards get 401s on their own
      // API calls. Resolves to the session (with email/roles) when valid.
      middlewareOptions.validateSession = (rawToken) => {
        const auth = this.getAuthProviderForTokens_();
        if (!auth || typeof auth.validateSession !== 'function') {
          return null;
        }
        return auth.validateSession(rawToken);
      };

      this.authMiddleware = createApiKeyAuthMiddleware(
        middlewareOptions,
        this.eventEmitter,
      );

      // Store auth config for services to use
      this.globalOptions.authMiddleware = this.authMiddleware;

      // Log API key authentication setup
      this.eventEmitter.emit('api-auth-setup', {
        message: 'API key authentication configured',
        keyCount: apiKeys.length,
        requireApiKey,
        excludePaths
      });
    } else {
      this.authMiddleware = null;
      delete this.globalOptions.authMiddleware;

      if (requireApiKey) {
        this.eventEmitter.emit('api-auth-warning', {
          message: 'API key authentication requested but no API keys provided',
          requireApiKey
        });
      }
    }

    // Initialize services auth middleware
    const servicesAuthRequired = normalizedSecurityConfig.servicesAuth.requireLogin !== false;

    if (servicesAuthRequired) {
      this.servicesAuthMiddleware = createServicesAuthMiddleware(this);
    } else {
      this.servicesAuthMiddleware = (req, res, next) => next();
      this.eventEmitter.emit('services-auth-disabled', {
        message: 'Services authentication disabled by configuration'
      });
    }

    // Apply authentication middleware to all /services routes
    // This enforces both authentication and admin role requirement across all service endpoints
    this.expressApp.use('/services', this.servicesAuthMiddleware);

    // Route-level permissions for /services/*/api (feature 19). Runs for every
    // caller that can be identified: session users, scoped keys and tokens.
    this.expressApp.use('/services', createPermissionGate({
      resolvePrincipal: (req) => this.resolveRequestPrincipal(req),
      eventEmitter: this.eventEmitter,
      declarations: this.routeDeclarations,
      strict: () => this.strictAuth
    }));

    // Serve the service registry landing page
    this.expressApp.get('/services/', (req, res) => {
      res.sendFile(path.join(__dirname, '/src/views', 'index.html'));
    });

    // Serve UI Service assets (CSS, JS) at /services/uiservice
    expressApp.use('/services/uiservice', express.static(path.join(__dirname, '/src/views')));

    // Serve static files from the views directory for caching service (excluding index.html)
    expressApp.use(
      '/services/',
      (req, res, next) => {
        // Exclude index.html from static serving since it's handled by the protected route above
        if (req.path === '/' || req.path === '/index.html') {
          return next();
        }
        next();
      },
      express.static(path.join(__dirname, '/src/views')),
    );

    // Add system monitoring API endpoints
    this.expressApp.get('/services/api/monitoring/metrics', (req, res) => {
      try {
        const metrics = systemMonitoring.getMetrics();
        res.status(200).json(metrics);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter: this.eventEmitter });
      }
    });

    this.expressApp.get('/services/api/monitoring/snapshot', (req, res) => {
      try {
        const snapshot = systemMonitoring.getCurrentSnapshot();
        res.status(200).json(snapshot);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter: this.eventEmitter });
      }
    });

    // One OpenAPI 3.1 document for the services this app has mounted (feature 10).
    this.expressApp.get('/services/api/openapi.json', (req, res) => {
      try {
        res.status(200).json(this.buildOpenApi());
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter: this.eventEmitter });
      }
    });

    // MCP server for coding agents (feature 03). Off unless `mcp.enabled` is set.
    const mcpConfig = globalOptions.mcp || {};
    this.mcpEnabled = mcpConfig.enabled === true;
    if (this.mcpEnabled) {
      mountMcp(this.expressApp, {
        services: this.mcpServices(),
        openApi: () => this.buildOpenApi(),
        allowWrite: mcpConfig.allowWrite === true,
        resolvePrincipal: (req) => this.resolveRequestPrincipal(req),
        eventEmitter: this.eventEmitter
      });
    }

    this.initialized = true;
    return this;
  }

  /**
   * Service accessors for the MCP server. Each one creates the default instance
   * of its service only when a tool first needs it.
   *
   * @return {Object} Accessors used by src/mcp
   */
  mcpServices() {
    return {
      logger: () => this.logger(),
      queue: () => this.queue(),
      dataService: () => this.dataService(),
      searching: () => this.searching(),
      workflow: () => this.workflow(),
      scheduling: () => this.scheduling(),
      cache: () => this.cache(),
      settings: () => this.settings(),
      monitoring: () => systemMonitoring,
      describe: () => ({ services: this.listServices() })
    };
  }

  /**
   * Builds the merged OpenAPI 3.1 document for the services mounted on this app.
   * Service documents are read once and reused; the routes are read on each call.
   *
   * @return {Object} OpenAPI 3.1 document
   */
  buildOpenApi() {
    if (!this.openApiServices_) {
      this.openApiServices_ = loadServiceDocuments(path.join(__dirname, 'src'));
    }
    const pkg = require('./package.json');
    return buildOpenApiDocument({
      services: this.openApiServices_,
      mounted: mountedBases(this.expressApp),
      routes: listApiRoutes(this.expressApp),
      info: { title: 'NooblyJS Core API', version: pkg.version },
      serverUrl: '/'
    });
  }

  /**
   * Initialize service dependency definitions according to the architecture hierarchy
   * Level 0: Foundation Services (No Dependencies)
   * Level 1: Infrastructure Services (Use Foundation)
   * Level 2: Business Logic Services (Use Infrastructure)
   * Level 3: Application Services (Use Business Logic)
   * Level 4: Integration Services (Use Application)
   */
  initializeServiceDependencies() {

    if (this.dependenciesInitialized) {
      return;
    }

    // Level 0 services (Foundation - No dependencies)
    this.serviceDependencies.set('logging', []);

    // Level 1 services (Infrastructure - Use foundation services)
    this.serviceDependencies.set('caching', ['logging']);
    this.serviceDependencies.set('queueing', ['logging']);
    this.serviceDependencies.set('notifying', ['logging']);
    this.serviceDependencies.set('appservice', ['logging']);
    this.serviceDependencies.set('fetching', ['logging']);
    this.serviceDependencies.set('settings', ['logging']);

    // Level 2 services (Business Logic - Use infrastructure services)
    this.serviceDependencies.set('dataservice', ['logging', 'queueing']);
    this.serviceDependencies.set('working', ['logging','queueing','caching']);
    this.serviceDependencies.set('measuring', ['logging','queueing','caching']);

    // Level 3 services (Application - Use business logic services)
    this.serviceDependencies.set('scheduling', ['logging', 'working']);
    this.serviceDependencies.set('searching', ['logging']);
    this.serviceDependencies.set('workflow', ['logging', 'queueing', 'scheduling', 'measuring', 'working']);
    this.serviceDependencies.set('filing', ['logging', 'queueing', 'dataservice']);

    // Level 4 services (Integration - Use application services)
    this.serviceDependencies.set('authservice', ['logging', 'caching', 'dataservice']);
    this.serviceDependencies.set('aiservice', ['logging', 'caching', 'workflow', 'queueing']);

    this.dependenciesInitialized = true;

    // Emit event for dependency system initialization
    this.eventEmitter.emit('dependencies:initialized', {
      message: 'Service dependency hierarchy initialized',
      dependencies: Object.fromEntries(this.serviceDependencies)
    });
    
  }

  /**
   * Gets or creates a service instance (singleton pattern with dependency injection)
   * Supports multiple named instances of the same service:provider combination
   * @param {string} serviceName - Name of the service
   * @param {string} providerType - Type of provider to use
   * @param {Object} options - Service-specific options
   * @param {string} options.instanceName - Optional instance name (defaults to 'default')
   * @returns {Object} Service instance
   */
  getService(serviceName, providerType = 'memory', options = {}) {
    if (!this.initialized) {
      throw new Error(
        'ServiceRegistry must be initialized before getting services',
      );
    }

    const { instanceName = 'default', ...serviceOptions } = options;
    const serviceKey = `${serviceName}:${providerType}:${instanceName}`;

    if (this.services.has(serviceKey)) {
      return this.services.get(serviceKey);
    }

    // Get dependencies for this service
    const dependencies = this.resolveDependencies(serviceName, providerType);

    // Check the caller's options against the schema for this service and provider (feature 08).
    const checkedOptions = assertServiceOptions(serviceName, providerType, serviceOptions, OPTION_SCHEMAS, {
      strict: this.strictOptions,
      onWarning: (message) => {
        this.eventEmitter?.emit?.('config:option-warning', { serviceName, providerType, message });
        if (process.env.NODE_ENV !== 'test') console.warn(`[nooblyjs-core] ${message}`);
      }
    });

    const mergedOptions = {
      ...this.globalOptions,
      ...checkedOptions,
      dependencies,
      instanceName, // Include instance name in options for service use
      ServiceRegistry: this, // Include ServiceRegistry reference for multi-instance support
      providerType // Include provider type for routes to use
    };

    let service;
    try {
      const serviceFactory = require(`${__dirname}/src/${serviceName}`);
      service = serviceFactory(providerType, mergedOptions, this.eventEmitter);
    } catch (error) {
      this.eventEmitter?.emit?.('service:creation-error', {
        serviceName,
        providerType,
        instanceName,
        error: error.message
      });
      throw new Error(
        `Failed to create service '${serviceName}' with provider '${providerType}' instance '${instanceName}': ${error.message}`,
      );
    }

    this.services.set(serviceKey, service);

    // Emit event for service creation with dependencies
    this.eventEmitter.emit('service:created', {
      serviceName,
      providerType,
      instanceName,
      dependenciesCount: Object.keys(dependencies).length,
      dependencyNames: Object.keys(dependencies)
    });

    return service;
  }

  /**
   * Gets a service instance by service name, provider type, and optional instance name
   * This is a convenience method for retrieving already-initialized instances
   * @param {string} serviceName - Name of the service
   * @param {string} providerType - Type of provider (defaults to 'memory')
   * @param {string} instanceName - Optional instance name (defaults to 'default')
   * @returns {Object|null} Service instance or null if not found
   */
  getServiceInstance(serviceName, providerType = 'memory', instanceName = 'default') {
    const serviceKey = `${serviceName}:${providerType}:${instanceName}`;
    return this.services.get(serviceKey) || null;
  }

  /**
   * Resolves the active authservice instance that can validate personal access
   * tokens. Returns the first registered authservice provider exposing
   * validateApiToken, or null when none has been created yet.
   * @return {?Object} Auth provider instance or null.
   * @private
   */
  getAuthProviderForTokens_() {
    for (const [key, service] of this.services.entries()) {
      if (key.startsWith('authservice:')
          && service
          && typeof service.validateApiToken === 'function') {
        return service;
      }
    }
    return null;
  }

  /**
   * Get the default provider type for a specific service
   * @param {string} serviceName - Name of the service
   * @returns {string} Default provider type for the service
   */
  getDefaultProviderType(serviceName) {
    // An app-declared override (via setDefaultProvider) wins, so dependency
    // injection picks the same provider the app instantiated.
    if (this.defaultProviderConfig.has(serviceName)) {
      return this.defaultProviderConfig.get(serviceName).providerType;
    }

    const defaultProviders = {
      'logging': 'memory',
      'filing': 'local',
      'measuring': 'memory',
      'caching': 'memory',
      'dataservice': 'memory',
      'working': 'memory',
      'queueing': 'memory',
      'scheduling': 'memory',
      'searching': 'memory',
      'workflow': 'memory',
      'notifying': 'memory',
      'authservice': 'file',
      'aiservice': 'claude',
      'fetching': 'node',
      'settings': 'file'
    };

    return defaultProviders[serviceName] || 'memory';
  }

  /**
   * Declare the default provider (and options) for a service. Dependency
   * injection then creates/reuses this provider wherever the service is needed,
   * so a provider chosen once is shared everywhere instead of dependents
   * silently falling back to the built-in default (e.g. an in-memory queue).
   *
   * Call this BEFORE the first service that depends on `serviceName` is created
   * — dependencies are resolved at creation time and the result is cached.
   *
   * @param {string} serviceName - e.g. 'queueing'
   * @param {string} providerType - e.g. 'activemq'
   * @param {Object} [options] - Provider options passed when the dependency is
   *   created (e.g. ActiveMQ host/port/credentials).
   * @returns {ServiceRegistry} this (chainable)
   */
  setDefaultProvider(serviceName, providerType, options = {}) {
    this.defaultProviderConfig.set(serviceName, { providerType, options });
    return this;
  }

  /**
   * Resolve dependencies for a service by creating dependent services first
   * @param {string} serviceName - Name of the service
   * @param {string} requestedProviderType - Provider type requested for the main service
   * @returns {Object} Object containing dependency service instances
   */
  resolveDependencies(serviceName, requestedProviderType = 'memory') {
    const dependencies = {};
    const requiredDependencies = this.serviceDependencies.get(serviceName) || [];

    for (const depServiceName of requiredDependencies) {
      const depProviderType = this.getDefaultProviderType(depServiceName);
      // Use any app-declared options for this dependency (e.g. ActiveMQ
      // connection settings) so the injected instance is configured correctly
      // rather than created with bare provider defaults.
      const depConfig = this.defaultProviderConfig.get(depServiceName);
      const depOptions = depConfig ? depConfig.options : {};

      // getService is the single source of truth for the singleton cache
      // (keyed by service:provider:instance), so just delegate to it — it
      // returns the existing instance if one was already created.
      dependencies[depServiceName] = this.getService(depServiceName, depProviderType, depOptions);
    }

    return dependencies;
  }

  /**
   * Get service initialization order using topological sort
   * This ensures dependencies are initialized before services that depend on them
   * @returns {Array<string>} Array of service names in initialization order
   */
  getServiceInitializationOrder() {
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (serviceName) => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected involving service: ${serviceName}`);
      }

      if (!visited.has(serviceName)) {
        visiting.add(serviceName);

        const dependencies = this.serviceDependencies.get(serviceName) || [];
        for (const dependency of dependencies) {
          visit(dependency);
        }

        visiting.delete(serviceName);
        visited.add(serviceName);
        order.push(serviceName);
      }
    };

    // Visit all services
    for (const serviceName of this.serviceDependencies.keys()) {
      visit(serviceName);
    }

    return order;
  }

  /**
   * Validates that the dependency graph has no circular dependencies
   * @returns {boolean} True if dependency graph is valid
   * @throws {Error} If circular dependencies are detected
   */
  validateDependencies() {
    try {
      this.getServiceInitializationOrder();
      return true;
    } catch (error) {
      throw new Error(`Dependency validation failed: ${error.message}`);
    }
  }

  /**
   * Get the caching service
   * @param {string} providerType - 'memory', 'redis', or 'memcached'
   * @param {Object} options - Provider-specific options
   * @param {string} options.instanceName - Optional instance name (defaults to 'default')
   * @returns {Object} Cache service instance
   */
  cache(providerType = 'memory', options = {}) {
    return this.getService('caching', providerType, options);
  }

  /**
   * Get the logging service
   * @param {string} providerType - 'memory' or 'file'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Logger service instance
   */
  logger(providerType = 'memory', options = {}) {
    return this.getService('logging', providerType, options);
  }

  /**
   * Get the data service
   * @param {string} providerType - 'memory', 'simpledb', 'file', 'mongodb', or 'documentdb'
   * @param {Object} options - Provider-specific options
   * @param {string} options.connectionString - MongoDB/DocumentDB connection string (for mongodb/documentdb provider)
   * @param {string} options.database - Database name (for mongodb/documentdb provider)
   * @param {string} options.host - DocumentDB host (for documentdb provider, defaults to '127.0.0.1')
   * @param {number} options.port - DocumentDB port (for documentdb provider, defaults to 10260)
   * @param {string} options.username - Username for authentication (for documentdb provider)
   * @param {string} options.password - Password for authentication (for documentdb provider)
   * @param {boolean} options.ssl - Enable SSL connection (for documentdb provider)
   * @returns {Object} DataService instance
   */
  dataService(providerType = 'memory', options = {}) {
    return this.getService('dataservice', providerType, options);
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
   * Get the settings service
   * @param {string} providerType - 'file' (encrypted JSON file)
   * @param {Object} options - Provider-specific options
   * @param {string} options.filepath - Path of the encrypted settings file
   * @param {string} options.secret - Master secret used to derive the encryption key
   * @returns {Object} Settings service instance
   */
  settings(providerType = 'file', options = {}) {
    return this.getService('settings', providerType, options);
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
   * Get the fetching service
   * @param {string} providerType - 'node' or 'axios'
   * @param {Object} options - Provider-specific options
   * @param {number} options.cacheTime - Default cache duration in seconds (default: 60)
   * @param {number} options.timeout - Request timeout in milliseconds (default: 30000)
   * @returns {Object} Fetching service instance
   */
  fetching(providerType = 'node', options = {}) {
    return this.getService('fetching', providerType, options);
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
   * Get the authentication service
   * @param {string} providerType - 'file', 'memory', 'passport', or 'google'
   * @param {Object} options - Provider-specific options
   * @param {string} options.dataDir - Directory for user data files (for file provider)
   * @param {string} options.clientID - Google OAuth client ID (for google provider)
   * @param {string} options.clientSecret - Google OAuth client secret (for google provider)
   * @param {string} options.callbackURL - OAuth callback URL (for google provider)
   * @param {boolean} options.createDefaultAdmin - Create default admin user (for memory provider)
   * @returns {Object} Auth service instance
   */
  authservice(providerType, options = {}) {
    // If no provider type specified, return the first existing authservice instance
    if (!providerType) {
      for (const [key, service] of this.services.entries()) {
        if (key.startsWith('authservice:')) {
          return service;
        }
      }
      // If no instance exists, use the default provider
      providerType = this.getDefaultProviderType('authservice');
    }
    return this.getService('authservice', providerType, options);
  }
  
  /**
   * Get the app service
   * @param {string} providerType - 'file', 'memory', 'passport', or 'google'
   * @param {Object} options - Provider-specific options
   * @returns {Object} Auth service instance
   */
  appservice(providerType, options = {}) {
    return this.getService('appservice', providerType, options);
  }

  /**
   * Get the event emitter for inter-service communication
   * @returns {EventEmitter} The global event emitter
   */
  /**
   * Works out who is calling, for the permission gate (feature 19).
   * A session gives the roles of its user; an API key gives its scopes; a
   * personal access token gives the roles of its owner.
   *
   * @param {import('express').Request} req Request to identify
   * @return {Promise<?{principal: string, roles?: string[], scopes?: ?string[]}>} Caller, or null when unidentified
   */
  async resolveRequestPrincipal(req) {
    if (req.user) {
      const roles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role || 'user'];
      return { principal: req.user.email || 'session', roles };
    }

    const authz = req.headers.authorization || '';
    const headerKey = req.headers['x-api-key'] || req.headers['api-key']
      || (authz.startsWith('ApiKey ') ? authz.slice(7) : null);
    const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : null;

    if (headerKey) {
      const general = this.globalOptions?.apiKeys || this.securityConfig?.apiKeyAuth?.apiKeys || [];
      const admin = this.globalOptions?.adminApiKeys || this.securityConfig?.servicesAuth?.apiKeys || [];
      const entry = findKeyEntry(headerKey, normalizeKeyEntries([...admin, ...general]));
      return entry ? { principal: `key:${entry.name}`, scopes: entry.scopes } : null;
    }

    if (bearer && bearer.startsWith('dtk_')) {
      try {
        const info = await this.authservice().validateApiToken(bearer);
        // A token may carry fewer permissions than its owner's roles (feature 19).
        return { principal: info.email, roles: info.roles, tokenScopes: info.scopes ?? null };
      } catch (_err) {
        return null;
      }
    }
    return null;
  }

  /**
   * Checks that every /services/*\/api route has a declared permission (feature 19).
   * In strictAuth mode (the default in production) an undeclared route throws, so
   * start-up fails. Call it once every service is created, since services register
   * their routes when they are created.
   *
   * @return {Array<string>} Undeclared routes (`METHOD pattern`); empty when all are declared
   * @throws {Error} In strictAuth mode, when any route is undeclared
   */
  verifyRouteDeclarations() {
    if (!this.expressApp) return [];
    const missing = findUndeclaredRoutes(this.expressApp, this.routeDeclarations);
    if (missing.length === 0) return missing;
    const message = `Undeclared API routes (add them to src/authservice/config/routePermissions.js): ${missing.join(', ')}`;
    if (this.strictAuth) throw new Error(message);
    this.logger?.warn?.(`[ServiceRegistry] ${message}`);
    return missing;
  }

  getEventEmitter() {
    return this.eventEmitter;
  }

  /**
   * Lists all initialized services
   * @returns {Array} Array of service keys in format "serviceName:providerType:instanceName"
   */
  listServices() {
    return Array.from(this.services.keys());
  }

  /**
   * Lists all instances of a specific service
   * @param {string} serviceName - Name of the service
   * @returns {Array} Array of instance objects with serviceName, providerType, and instanceName
   */
  listInstances(serviceName) {
    const instances = [];

    for (const key of this.services.keys()) {
      const [srvName, provider, instance] = key.split(':');
      if (srvName === serviceName) {
        instances.push({
          serviceName: srvName,
          providerType: provider,
          instanceName: instance,
          key: key
        });
      }
    }

    return instances;
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
   * Gracefully shuts down all initialized services by closing their connections
   * @return {Promise<void>}
   */
  async shutdown(options = {}) {
    if (!this.initialized) {
      return;
    }

    // Per-service teardown timeout so one hung disconnect cannot block the
    // whole shutdown (P2-5).
    const perServiceTimeoutMs = options.perServiceTimeoutMs || 5000;
    // Method names a service may expose to release resources, in priority order.
    const TEARDOWN_METHODS = [
      'stopConsumers', 'close', 'disconnect', 'stop', 'stopIndexing', 'shutdown', 'quit',
      'destroy', 'dispose', 'end'
    ];

    const logger = this.globalOptions && this.globalOptions.logger;
    const reportError = (key, error) => {
      if (logger?.error) {
        logger.error(`[ServiceRegistry] Error shutting down service ${key}`, {
          error: error?.message
        });
      } else if (this.eventEmitter) {
        this.eventEmitter.emit('registry:shutdown-error', {
          service: key,
          error: error?.message
        });
      }
    };

    const withTimeout = (promise, key) => {
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          reportError(key, new Error(`teardown timed out after ${perServiceTimeoutMs}ms`));
          resolve();
        }, perServiceTimeoutMs);
      });
      return Promise.race([
        Promise.resolve()
          .then(() => promise)
          .catch((error) => reportError(key, error)),
        timeout
      ]).finally(() => clearTimeout(timer));
    };

    const shutdownPromises = [];

    for (const [key, service] of this.services.entries()) {
      try {
        // Remove analytics listeners so they don't outlive the service (P2-6).
        if (service.analytics && typeof service.analytics.destroy === 'function') {
          service.analytics.destroy();
        }
        // Call the first teardown method the service exposes.
        const method = TEARDOWN_METHODS.find((m) => typeof service[m] === 'function');
        if (method) {
          shutdownPromises.push(withTimeout(service[method](), key));
        }
      } catch (error) {
        reportError(key, error);
      }
    }

    await Promise.allSettled(shutdownPromises);
    this.services.clear();
    this.initialized = false;

    if (this.eventEmitter) {
      this.eventEmitter.emit('registry:shutdown', {
        message: 'Service Registry shut down successfully',
        servicesCount: shutdownPromises.length
      });
    }
  }

  /**
   * Disposes a service's analytics listeners (and the service itself if it
   * exposes a destroy/dispose) so repeated create/reset cycles do not leak
   * event-emitter listeners (P2-6).
   * @param {Object} service - The service instance being removed.
   * @private
   */
  disposeService_(service) {
    if (!service) return;
    try {
      if (service.analytics && typeof service.analytics.destroy === 'function') {
        service.analytics.destroy();
      }
      if (typeof service.destroy === 'function') {
        service.destroy();
      } else if (typeof service.dispose === 'function') {
        service.dispose();
      }
    } catch (error) {
      if (this.eventEmitter) {
        this.eventEmitter.emit('registry:dispose-error', { error: error?.message });
      }
    }
  }

  /**
   * Clears all service instances (useful for testing)
   * This clears all named and default instances of all services
   */
  reset() {
    for (const service of this.services.values()) {
      this.disposeService_(service);
    }
    this.services.clear();

    // Detach any listeners and restore a fresh internal event emitter. Without
    // this, an emitter supplied to a previous initialize() call (and any
    // listeners attached to it) would persist across re-initialization,
    // accumulating listeners and firing stale handlers on later lifecycle
    // events. A subsequent initialize(app, null, ...) keeps this fresh emitter.
    if (this.eventEmitter && typeof this.eventEmitter.removeAllListeners === 'function') {
      this.eventEmitter.removeAllListeners();
    }
    this.eventEmitter = new EventEmitter();

    this.initialized = false;
  }

  /**
   * Resets a specific service (all instances of that service)
   * @param {string} serviceName - Name of the service to reset
   * @returns {number} Number of instances cleared
   */
  resetService(serviceName) {
    let count = 0;
    const keysToDelete = [];

    for (const key of this.services.keys()) {
      const [srvName] = key.split(':');
      if (srvName === serviceName) {
        keysToDelete.push(key);
        count++;
      }
    }

    keysToDelete.forEach(key => {
      this.disposeService_(this.services.get(key));
      this.services.delete(key);
    });
    return count;
  }

  /**
   * Resets a specific service instance
   * @param {string} serviceName - Name of the service
   * @param {string} providerType - Type of provider (defaults to 'memory')
   * @param {string} instanceName - Instance name (defaults to 'default')
   * @returns {boolean} True if instance was found and deleted
   */
  resetServiceInstance(serviceName, providerType = 'memory', instanceName = 'default') {
    const serviceKey = `${serviceName}:${providerType}:${instanceName}`;
    this.disposeService_(this.services.get(serviceKey));
    return this.services.delete(serviceKey);
  }

  /**
   * Debug helper to log all emitter events (for development purposes)
   * @param {EventEmitter} emitter - The event emitter to debug
   * @param {string} name - Name identifier for the emitter
   * @private
   */
  _debugEmitter(emitter, name) {
    const originalEmit = emitter.emit;
    emitter.emit = function(...args) {
      originalEmit.apply(emitter, args);
    };
  }
}

module.exports = new ServiceRegistry();
