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
const { mountOpenApiRoutes } = require('./src/shared/utils/openapiRoutes');
const { mountMcpRoutes } = require('./src/mcp/routes');
const { sendSafeError } = require('./src/shared/utils/safeError');
const { createPermissionMiddleware } = require('./src/authservice/middleware/permission');
const { buildRoleMap, normalizeApiKeys } = require('./src/authservice/modules/permissions');
const { listRoutes, listUndeclaredRoutes } = require('./src/authservice/policy/routePermissions');
const { checkServiceOptions } = require('./src/shared/utils/serviceOptions');
const {
  createCookieSessionHygiene,
  createOriginCheck,
  referrerPolicy
} = require('./src/authservice/middleware/sessionHygiene');

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

    // Feature 19: entries may be plain strings (full access) or scoped
    // objects ({ key, name, scopes }). `apiKeys` stays a list of strings for
    // matching; the scopes travel separately.
    const keyConfig = normalizeApiKeys(ensureArray(
      apiKeyAuthConfig.apiKeys !== undefined
        ? apiKeyAuthConfig.apiKeys
        : legacyOptions.apiKeys
    ));
    const apiKeys = keyConfig.keys;

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

      middlewareOptions.apiKeyScopes = keyConfig.scopes;

      this.authMiddleware = createApiKeyAuthMiddleware(
        middlewareOptions,
        this.eventEmitter,
      );

      // The permission layer authenticates every protected API request itself,
      // ignoring excludePaths (whose '*' patterns match across segments, e.g.
      // '/services/*/status' also matched '/services/filing/api/download/status').
      // Admin portal keys are accepted here with full access.
      const adminKeys = normalizeApiKeys(ensureArray(
        Array.isArray(legacyOptions.adminApiKeys)
          ? legacyOptions.adminApiKeys
          : servicesAuthConfig.apiKeys
      ));
      const policyScopes = new Map(keyConfig.scopes);
      for (const key of adminKeys.keys) {
        if (!policyScopes.has(key)) policyScopes.set(key, adminKeys.scopes.get(key));
      }
      this.permissionAuthMiddleware_ = createApiKeyAuthMiddleware(
        {
          ...middlewareOptions,
          apiKeys: Array.from(new Set([...apiKeys, ...adminKeys.keys])),
          apiKeyScopes: policyScopes,
          excludePaths: []
        },
        this.eventEmitter,
      );

      const unscoped = keyConfig.keys.filter((k) => keyConfig.scopes.get(k) === null);
      if (process.env.NODE_ENV === 'production' && unscoped.length > 0) {
        const message = `${unscoped.length} API key(s) have no scopes and grant full access. ` +
          'Configure apiKeys as [{ key, name, scopes }] (feature 19).';
        process.emitWarning(message, { code: 'NOOBLYJS_UNSCOPED_API_KEYS' });
        this.eventEmitter.emit('api-auth-warning', { message, unscopedKeys: unscoped.length });
      }

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

    // Feature 23: session hygiene runs before any guard. Cookie sessions get
    // idle and absolute timeouts and end when the password or roles change;
    // state-changing cookie requests from another origin are refused; and
    // dashboards send no Referer.
    const csrfConfig = normalizedSecurityConfig.csrf || {};
    this.expressApp.use('/services', referrerPolicy());
    this.expressApp.use('/services', createCookieSessionHygiene({
      getAuth: () => this.getAuthProviderForTokens_(),
      eventEmitter: this.eventEmitter
    }));
    if (csrfConfig.enabled !== false) {
      const envOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
      this.expressApp.use('/services', createOriginCheck({
        allowedOrigins: [...ensureArray(csrfConfig.allowedOrigins || []), ...envOrigins],
        eventEmitter: this.eventEmitter
      }));
    }

    // Apply authentication middleware to all /services routes
    // This enforces both authentication and admin role requirement across all service endpoints
    this.expressApp.use('/services', this.servicesAuthMiddleware);

    // Feature 19: every /services/*/api route needs a declared permission,
    // checked here in front of every service's own routes, so authorization
    // no longer depends on the portal guard alone.
    this.roleMap = buildRoleMap(normalizedSecurityConfig.roles);
    this.strictAuth = typeof normalizedSecurityConfig.strictAuth === 'boolean'
      ? normalizedSecurityConfig.strictAuth
      : process.env.NODE_ENV === 'production';
    this.permissionMiddleware = createPermissionMiddleware({
      authenticate: this.permissionAuthMiddleware_ || ((req, res, next) => next()),
      roleMap: this.roleMap,
      enabled: Boolean(this.authMiddleware) && requireApiKey !== false,
      strict: this.strictAuth,
      eventEmitter: this.eventEmitter
    });
    this.expressApp.use('/services', this.permissionMiddleware);

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

    // Feature 03: MCP endpoint for coding agents. Off unless `mcp: { enabled: true }`.
    const mcpConfig = (this.globalOptions && this.globalOptions.mcp) || {};
    if (mcpConfig.enabled === true) {
      mountMcpRoutes(this.expressApp, {
        registry: this,
        eventEmitter: this.eventEmitter,
        config: mcpConfig,
        serverInfo: { name: 'nooblyjs-core', version: require('./package.json').version }
      });
    }

    // Feature 10: one OpenAPI document for every mounted API route, plus a reference page.
    mountOpenApiRoutes(this.expressApp, {
      version: require('./package.json').version,
      eventEmitter: this.eventEmitter
    });

    this.initialized = true;
    return this;
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
    // Knowledge (feature 05) takes its filing, search and AI instances as options; only logging is injected.
    this.serviceDependencies.set('knowledge', ['logging']);
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

    // Feature 08: check the caller's options against the service's schema
    // (typos warn with a suggestion, wrong types throw, strictOptions makes
    // warnings errors) and map canonical names onto legacy spellings.
    const { options: checkedOptions } = checkServiceOptions(serviceName, providerType, serviceOptions, {
      strict: Boolean(this.globalOptions && this.globalOptions.strictOptions),
      report: (message) => this.reportOptionWarning_(serviceName, message)
    });

    // Get dependencies for this service
    const dependencies = this.resolveDependencies(serviceName, providerType);

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
      const wrapped = new Error(
        `Failed to create service '${serviceName}' with provider '${providerType}' instance '${instanceName}': ${error.message}`,
        { cause: error },
      );
      if (error && error.code) wrapped.code = error.code; // e.g. OPTIONAL_DEPENDENCY_MISSING (feature 20b)
      throw wrapped;
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
   * Reports an options warning (feature 08): through the logger when one
   * exists, otherwise as a process warning, and always as an event.
   * @param {string} serviceName - Service being created
   * @param {string} message - Warning text
   * @private
   */
  reportOptionWarning_(serviceName, message) {
    this.eventEmitter?.emit?.('service:options-warning', { serviceName, message });
    const logger = serviceName !== 'logging'
      ? Array.from(this.services.entries()).find(([key]) => key.startsWith('logging:'))?.[1]
      : null;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[ServiceRegistry] ${message}`);
    } else {
      process.emitWarning(message, { code: 'NOOBLYJS_OPTIONS' });
    }
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
   * Get the knowledge service (feature 05): answers with citations over a filing source.
   * @param {string} providerType - 'default'
   * @param {Object} options - `filing`, `search` (a searching instance), `ai` (an aiservice instance), `source: { path }`
   * @returns {Object} Knowledge service instance
   */
  knowledge(providerType = 'default', options = {}) {
    return this.getService('knowledge', providerType, options);
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
      'close', 'disconnect', 'stop', 'stopIndexing', 'shutdown', 'quit',
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
        // Feature 06: queue consumers drain (or hand their jobs back) first.
        const drain = typeof service.stopConsumers === 'function'
          ? () => service.stopConsumers({ timeoutMs: Math.max(100, perServiceTimeoutMs - 500) })
          : () => undefined;
        if (method || typeof service.stopConsumers === 'function') {
          shutdownPromises.push(withTimeout(Promise.resolve().then(drain).then(() => method && service[method]()), key));
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
      if (typeof service.stopConsumers === 'function') {
        Promise.resolve(service.stopConsumers({ timeoutMs: 0 })).catch(() => {});
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
   * Checks that every registered /services API route has a declared
   * permission (feature 19). Call it once all services are created, before
   * the server starts listening.
   *
   * @param {Object=} options - Options
   * @param {boolean=} options.strict - Throw on undeclared routes (default:
   *     `security.strictAuth`, which defaults to true in production)
   * @return {!Array<string>} Undeclared routes as 'METHOD /path'
   * @throws {Error} In strict mode, when any route is undeclared
   *
   * @example
   * serviceRegistry.verifyRoutePermissions(); // after wiring, before listen()
   */
  verifyRoutePermissions(options = {}) {
    const undeclared = listUndeclaredRoutes(listRoutes(this.expressApp));
    const strict = typeof options.strict === 'boolean' ? options.strict : Boolean(this.strictAuth);
    if (undeclared.length > 0) {
      this.eventEmitter?.emit('auth:permission-undeclared-routes', { routes: undeclared });
      if (strict) {
        throw new Error(
          `${undeclared.length} /services route(s) have no declared permission: ${undeclared.slice(0, 10).join(', ')}` +
          '. Add them to src/authservice/policy/routePermissions.js.'
        );
      }
    }
    return undeclared;
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
