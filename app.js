/**
 * @fileoverview Application demonstrating NooblyJS Core services.
 * This file serves as a comprehensive example of how to use all available
 * services in the NooblyJS Core framework.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
// Patch Express so rejected async route handlers are forwarded to the error
// handler instead of becoming unhandled rejections (P0-5). Must be required
// before routes are registered.
require('express-async-errors');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const config = require('dotenv').config({quiet: true });
// HTTP / HTTPS server — transport is controlled by HTTPS_ENABLED in .env.
// See src/shared/utils/createServer.js for the supported HTTPS_* variables.
// Generate development certificates with: npm run certs
const { createServer, createHttpRedirectServer } = require('./src/shared/utils/createServer');
const { createSessionStore } = require('./src/shared/utils/sessionStore');
const { helmetCspOption } = require('./src/shared/utils/contentSecurityPolicy');

/** Maximum accepted request body size (P2-2). Override via BODY_LIMIT. */
const BODY_LIMIT = process.env.BODY_LIMIT || '1mb';

/** Comma-separated list of allowed CORS origins (P2-1). */
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const parseCommaSeparated = (value = '') =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

// Create the Express application
const app = express();

// N-3: Behind a TLS-terminating proxy/load balancer, Express must trust
// X-Forwarded-Proto so secure session cookies are issued. Only enable this
// when a proxy really sits in front (it also makes req.ip use X-Forwarded-For).
// TRUST_PROXY accepts "true", a hop count ("1") or a subnet list.
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY;
  app.set('trust proxy', trustProxy === 'true' ? true : (/^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy));
}

// Security headers (P2-1) including a Content-Security-Policy (N-7) that
// pins the dashboards' external origins. CSP_MODE=report-only|off to relax.
app.use(helmet({ contentSecurityPolicy: helmetCspOption() }));

// CORS (P2-1): same-origin only unless explicit origins are configured.
app.use(cors({
  origin: corsOrigins.length > 0 ? corsOrigins : false,
  credentials: true
}));

// Body parsers with explicit size limits (P2-2).
app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

/**
 * Configure session management with secure defaults
 * SESSION_SECRET environment variable is required for secure session storage
 */
const sessionSecret = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret && isProduction) {
  console.error('FATAL ERROR: SESSION_SECRET is not set in production.');
  console.error('Set the SESSION_SECRET environment variable to a strong, random value.');
  console.error('Example: export SESSION_SECRET=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  process.exit(1);
}

if (!sessionSecret && !isProduction) {
  console.warn('⚠️  WARNING: SESSION_SECRET is not set. Using development default.');
  console.warn('   For production, set SESSION_SECRET to a secure random value.');
}

if (isProduction && !process.env.TRUST_PROXY && process.env.HTTPS_ENABLED !== 'true') {
  console.warn('⚠️  WARNING: Session cookies are marked Secure in production but this server is plain HTTP.');
  console.warn('   Behind an HTTPS load balancer set TRUST_PROXY=1, or enable HTTPS_ENABLED; otherwise logins will not persist.');
}

// N-4: Shared Redis session store when SESSION_REDIS_URL/REDIS_URL is set,
// otherwise a single-process memory store that evicts expired sessions.
const sessionStore = createSessionStore(session);
if (isProduction && sessionStore.type === 'memory') {
  console.warn('⚠️  WARNING: Using the in-process session store. Sessions are lost on restart and not shared');
  console.warn('   between replicas. Set SESSION_REDIS_URL (or REDIS_URL) for multi-instance deployments.');
}

app.use(session({
  store: sessionStore.store,
  secret: sessionSecret || 'dev-only-insecure-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  // Feature 23: the cookie is renewed on activity; the registry enforces the
  // idle timeout (30 minutes for admins) and the absolute 24-hour lifetime.
  rolling: true,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// Load the service registry library
const serviceRegistry = require('./index');

/**
 * Configure API keys for authentication
 *
 * Environment Variables (in order of precedence):
 * - NOOBLYJS_API_KEYS: Comma-separated API keys (legacy name)
 * - API_KEYS: Comma-separated API keys
 * - API_KEY: Single API key
 *
 * ⚠️ SECURITY WARNING:
 * - In PRODUCTION: API keys must be set via environment variables. Never auto-generated.
 * - In DEVELOPMENT: If no keys are configured, one will be auto-generated for convenience.
 *   Auto-generated keys are logged to console. DO NOT use in production.
 * - API keys should be long, random values (min 32 characters recommended)
 * - Rotate API keys regularly
 * - Never commit API keys to version control
 */
const configuredApiKeys = parseCommaSeparated(
  process.env.NOOBLYJS_API_KEYS || process.env.API_KEYS || process.env.API_KEY || ''
);

// Enforce strict security in production
if (configuredApiKeys.length === 0 && isProduction) {
  console.error('FATAL ERROR: No API keys configured for production.');
  console.error('Set API_KEYS or API_KEY environment variable with comma-separated values.');
  console.error('Example: export API_KEYS="key1,key2,key3"');
  process.exit(1);
}

// Generate a development API key only if not in production
let generatedDevApiKey = null;
if (configuredApiKeys.length === 0 && !isProduction) {
  generatedDevApiKey = serviceRegistry.generateApiKey();
  configuredApiKeys.push(generatedDevApiKey);
  console.warn('⚠️  DEVELOPMENT MODE: Generated temporary API key (for testing only)');
  console.warn(`    API Key: ${generatedDevApiKey}`);
  console.warn('    Store this key to test API endpoints.');
  console.warn('    For production, set API_KEYS environment variable with real keys.');
}

// Instantiate the options
// options.logDir - Directory for log files
// options.dataDir - Directory for data storage
// options.apiKeys - Array of valid API keys
// options.requireApiKey - Boolean indicating if API key is required
// options.excludePaths - Array of paths to exclude from API key checks
const options = {
  logDir: path.join(__dirname, './.application/', 'logs'),
  dataDir: path.join(__dirname, './.application/', 'data'),
  apiKeys: configuredApiKeys,
  requireApiKey: configuredApiKeys.length > 0,
  excludePaths: [
    '/services/*/status',
    '/services/',
    '/services/uiservice/*',
    '/services/*/views/*',
    '/services/authservice/api/login',
    '/services/authservice/api/register'
  ]
};

// Initialize the service registry
const eventEmitter = new EventEmitter();
serviceRegistry.initialize(app, eventEmitter, options);

// Initialize all services
const log = serviceRegistry.logger('file');
app.set('logger', log); // Make logger available to app
const cache = serviceRegistry.cache('inmemory');
const dataService = serviceRegistry.dataService('file');
// N-15: Keep uploaded files in a dedicated directory. The local provider's
// default base directory is the process working directory, which would expose
// .env, .application/data (users, sessions) and the source tree via the API.
const filingBaseDir = process.env.FILING_BASE_DIR || path.join(__dirname, '.application', 'files');
require('node:fs').mkdirSync(filingBaseDir, { recursive: true });
const filing = serviceRegistry.filing('local', { baseDir: filingBaseDir });
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');
const fetching = serviceRegistry.fetching('node');
const authservice = serviceRegistry.authservice('file');
const settings = serviceRegistry.settings('file');
const aiservice = serviceRegistry.aiservice('ollama', {});

/**
 * Setup production health checks for load balancers and orchestration
 * Provides:
 * - /health - Quick liveness check (Docker, load balancers)
 * - /health/live - Kubernetes liveness probe
 * - /health/ready - Kubernetes readiness probe
 * - /health/startup - Kubernetes startup probe
 * - /health/detailed - Full status report (protected)
 */
const { createHealthCheckMiddleware } = require('./src/middleware/healthCheck');
const setupHealthChecks = createHealthCheckMiddleware({
  logger: log,
  criticalDependencies: ['cache', 'dataService'],
  // P1-1: real, live dependency checks rather than trusting in-memory state.
  dependencyCheckers: {
    // Cache round-trip: write a probe key and read it back.
    cache: async () => {
      const key = '__healthcheck__';
      await cache.put(key, '1');
      const value = await cache.get(key);
      return value === '1';
    },
    // Data service connectivity: a lightweight settings read must succeed.
    dataService: async () => {
      await dataService.getSettings();
      return true;
    }
  }
});

// Setup health check endpoints (must be before other middleware)
const healthCheckManager = setupHealthChecks(app, serviceRegistry.servicesAuthMiddleware);

// P1-1: Only mark ready once the critical dependencies actually pass a live
// check. Until then /health/ready returns 503 so traffic is not routed in.
healthCheckManager.checkCriticalDependencies()
  .then((healthy) => {
    if (healthy) {
      healthCheckManager.markReady();
    } else {
      log.warn('[HealthCheck] Critical dependencies not healthy at startup; readiness deferred.');
    }
  })
  .catch((error) => {
    log.error('[HealthCheck] Startup dependency check failed:', error.message);
  });

// Configure MIME types for static files
app.use((req, res, next) => {
  if (req.path.endsWith('.css')) {
    res.type('text/css');
  }
  next();
});

// Serve public static files (logo, favicon, ...). index: false keeps '/' on
// the redirect below instead of serving public/index.html.
app.use('/', express.static(path.join(__dirname, 'public'), { index: false }));

// Redirect to services
app.get('/', (req, res) => {
  res.redirect('/services');
});

// ... (docs/ui route definitions)

// Global Error Handler
const errorHandler = require('./src/middleware/errorHandler');
app.use(errorHandler);

// Feature 19: every /services API route must declare a permission. In
// production (strictAuth) an undeclared route stops start-up here.
const undeclaredRoutes = serviceRegistry.verifyRoutePermissions();
if (undeclaredRoutes.length > 0) {
  console.warn(`⚠️  ${undeclaredRoutes.length} /services route(s) have no declared permission:`, undeclaredRoutes);
}

// Build an HTTP or HTTPS server depending on HTTPS_ENABLED in .env.
const PORT = process.env.PORT || 11000;
const { server, protocol, httpsEnabled } = createServer(app, { baseDir: __dirname });

// When serving HTTPS, also listen on HTTP and 301-redirect to the HTTPS URL so
// plain-HTTP clients are bounced to the secure endpoint. A failure to bind the
// redirect port (e.g. port 80 needs privileges, or it's already in use) is
// logged but does not stop the main server.
let httpRedirectServer = null;

server.listen(PORT, () => {
  log.info(`Server is running on port ${PORT} (${protocol.toUpperCase()})`);
  log.info(`  ${protocol}://localhost:${PORT}`);
  if (httpsEnabled) {
    log.info('  Note: self-signed certificates trigger a browser warning — accept it to proceed.');
  }
});

if (httpsEnabled) {
  const { server: redirectServer, port: redirectPort } = createHttpRedirectServer({ httpsPort: PORT });
  httpRedirectServer = redirectServer;

  httpRedirectServer.on('error', (error) => {
    if (error.code === 'EACCES') {
      log.warn(`HTTP→HTTPS redirect: cannot bind port ${redirectPort} (insufficient privileges). ` +
        'Set HTTP_REDIRECT_PORT to an unprivileged port (>1024), or run with elevated privileges.');
    } else if (error.code === 'EADDRINUSE') {
      log.warn(`HTTP→HTTPS redirect: port ${redirectPort} already in use. Set HTTP_REDIRECT_PORT to a free port.`);
    } else {
      log.warn(`HTTP→HTTPS redirect server error: ${error.message}`);
    }
  });

  httpRedirectServer.listen(redirectPort, () => {
    log.info(`HTTP→HTTPS redirect listening on port ${redirectPort} → https://localhost:${PORT}`);
  });
}

// Handle graceful shutdown
let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log.info(`${signal} received. Starting graceful shutdown...`);

  // P2-5: Force-exit watchdog so a hung teardown cannot wedge the process.
  const forceTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15000;
  const forceTimer = setTimeout(() => {
    log.error(`Graceful shutdown exceeded ${forceTimeoutMs}ms. Forcing exit.`);
    process.exit(1);
  }, forceTimeoutMs);
  forceTimer.unref();

  try {
    // Stop accepting new connections, then tear down services.
    await new Promise((resolve) => server.close(resolve));
    if (httpRedirectServer) {
      await new Promise((resolve) => httpRedirectServer.close(resolve));
      log.info('HTTP→HTTPS redirect server closed.');
    }
    await serviceRegistry.shutdown();
    await sessionStore.close();
    log.info('All services shut down successfully.');
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (error) {
    log.error('Error during graceful shutdown:', error.message);
    clearTimeout(forceTimer);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Process-level safety nets (P0-5): log and shut down cleanly instead of
// crashing uncontrolled. A failed shutdown still forces exit via gracefulShutdown.
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error?.stack || error?.message || error);
  gracefulShutdown('uncaughtException');
});
