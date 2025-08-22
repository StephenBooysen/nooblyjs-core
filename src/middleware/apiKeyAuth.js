/**
 * @fileoverview API Key Authentication Middleware
 * Provides secure API key validation for all NooblyJS service endpoints.
 * 
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.2.1
 */

'use strict';

/**
 * API Key Authentication Middleware
 * 
 * This middleware validates API keys for secure access to service endpoints.
 * API keys can be provided via:
 * 1. x-api-key header
 * 2. api-key header  
 * 3. Authorization header with "Bearer <api-key>" or "ApiKey <api-key>" format
 * 4. api_key query parameter
 * 
 * @param {Object} options - Configuration options
 * @param {string[]} options.apiKeys - Array of valid API keys
 * @param {boolean} options.requireApiKey - Whether API key is required (default: true)
 * @param {string[]} options.excludePaths - Paths to exclude from API key validation
 * @param {Object} eventEmitter - Event emitter for logging
 * @returns {Function} Express middleware function
 */
function createApiKeyAuthMiddleware(options = {}, eventEmitter = null) {
  const {
    apiKeys = [],
    requireApiKey = true,
    excludePaths = ['/services/*/status', '/services/', '/services/*/views/*']
  } = options;

  return (req, res, next) => {
    // Skip authentication if not required
    if (!requireApiKey) {
      return next();
    }

    // Check if path should be excluded from authentication
    const shouldExclude = excludePaths.some(pattern => {
      // Replace * with [^/]+ for more precise matching (one or more non-slash characters)
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
      return regex.test(req.path);
    });

    if (shouldExclude) {
      return next();
    }

    // Extract API key from various sources
    let apiKey = null;

    // 1. Check x-api-key header
    apiKey = req.headers['x-api-key'];

    // 2. Check api-key header
    if (!apiKey) {
      apiKey = req.headers['api-key'];
    }

    // 3. Check Authorization header
    if (!apiKey && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      
      // Bearer token format
      if (authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
      }
      
      // ApiKey format
      if (authHeader.startsWith('ApiKey ')) {
        apiKey = authHeader.substring(7);
      }
    }

    // 4. Check query parameter
    if (!apiKey) {
      apiKey = req.query.api_key;
    }

    // Validate API key presence
    if (!apiKey) {
      if (eventEmitter) {
        eventEmitter.emit('api-auth-failure', {
          reason: 'missing-api-key',
          ip: req.ip,
          path: req.path,
          method: req.method
        });
      }

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key is required. Provide it via x-api-key header, Authorization header, or api_key query parameter.',
        code: 'MISSING_API_KEY'
      });
    }

    // Validate API key
    if (!apiKeys.includes(apiKey)) {
      if (eventEmitter) {
        eventEmitter.emit('api-auth-failure', {
          reason: 'invalid-api-key',
          ip: req.ip,
          path: req.path,
          method: req.method,
          providedKey: apiKey.substring(0, 8) + '...' // Log only first 8 chars for security
        });
      }

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key provided.',
        code: 'INVALID_API_KEY'
      });
    }

    // API key is valid - log success and continue
    if (eventEmitter) {
      eventEmitter.emit('api-auth-success', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        keyPrefix: apiKey.substring(0, 8) + '...'
      });
    }

    // Store the validated API key in request for potential use by routes
    req.apiKey = apiKey;
    
    next();
  };
}

/**
 * Generate a secure API key
 * @param {number} length - Length of the API key (default: 32)
 * @returns {string} Generated API key
 */
function generateApiKey(length = 32) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let apiKey = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    apiKey += charset[randomIndex];
  }
  
  return apiKey;
}

/**
 * Validate API key format
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} Whether the API key format is valid
 */
function isValidApiKeyFormat(apiKey) {
  if (typeof apiKey !== 'string') {
    return false;
  }
  
  // API key should be at least 16 characters and contain only alphanumeric characters
  return /^[A-Za-z0-9]{16,}$/.test(apiKey);
}

module.exports = {
  createApiKeyAuthMiddleware,
  generateApiKey,
  isValidApiKeyFormat
};