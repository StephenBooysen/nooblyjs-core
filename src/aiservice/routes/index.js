/**
 * @fileoverview AI API routes for Express.js application.
 * Provides RESTful endpoints for AI operations, prompt processing, and analytics retrieval.
 *
 * Supports multiple named instances of the AI service through optional
 * instance parameter in URL paths (e.g. /services/ai/api/:instanceName/prompt).
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');
const { sendSafeError } = require('../../shared/utils/safeError');
const { capLimit } = require('../../shared/utils/validation');

/**
 * Configures and registers AI service routes with the Express application.
 * Sets up endpoints for AI operations and monitoring, for both the default
 * instance and any named instances registered with the ServiceRegistry.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} [options.ServiceRegistry] - ServiceRegistry singleton for instance lookup
 * @param {string} [options.providerType] - Provider type of the default instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} aiService - The default AI provider instance
 * @param {Object=} analytics - Prompt analytics module for the default instance
 * @return {void}
 */
module.exports = (options, eventEmitter, aiService, analytics) => {
  
  if (!options['express-app'] || !aiService) {
    return;
  }

  const app = options['express-app'];
  const ServiceRegistry = options.ServiceRegistry;
  const providerType = options.providerType || 'claude';

  // Serve the OpenAPI spec consumed by the Swagger UI on the dashboard.
  // Registered before the auth guard so API documentation stays public.
  app.use('/services/ai/api/swagger', express.static(path.join(__dirname, 'swagger')));

  // Enforce authentication on every AI API endpoint. Mounting the shared
  // API-key/session middleware on the /api prefix protects all routes below
  // (default and instance-aware) regardless of how each handler is registered.
  // Falls back to a pass-through only when no auth is configured.
  const requireApiAuth = options.authMiddleware || ((req, res, next) => next());
  app.use('/services/ai/api', requireApiAuth);

  /**
   * Resolves an AI service instance by name. Falls back to the default
   * instance when no name is given or the named instance cannot be found.
   * Instances may use different providers, so the registry is searched by
   * instance name rather than assuming a fixed provider type.
   *
   * @param {string} instanceName - Instance name to resolve.
   * @return {Object} The resolved AI service instance.
   */
  const resolveInstance = (instanceName) => {
    if (!instanceName || instanceName === 'default') {
      return aiService;
    }
    if (ServiceRegistry) {
      const match = (ServiceRegistry.listInstances('aiservice') || [])
        .find((inst) => inst.instanceName === instanceName);
      if (match) {
        const instance = ServiceRegistry.getServiceInstance('aiservice', match.providerType, instanceName);
        if (instance) {
          return instance;
        }
      }
    }
    return aiService;
  };

  /**
   * Returns the analytics module belonging to a given service instance.
   * @param {Object} svc - AI service instance.
   * @return {Object|undefined} The analytics module for that instance.
   */
  const analyticsFor = (svc) => (svc && svc.promptAnalytics) || analytics;

  /**
   * GET /services/ai/api/instances
   * Returns a list of all available AI service instances.
   */
  app.get('/services/ai/api/instances', (req, res) => {
    try {
      const instances = [];
      const seen = new Set();

      if (ServiceRegistry) {
        (ServiceRegistry.listInstances('aiservice') || []).forEach((inst) => {
          if (!seen.has(inst.instanceName)) {
            seen.add(inst.instanceName);
            instances.push({
              name: inst.instanceName,
              provider: inst.providerType,
              status: 'active'
            });
          }
        });
      }

      // Ensure the default instance is always present.
      if (!seen.has('default')) {
        instances.unshift({ name: 'default', provider: providerType, status: 'active' });
      }

      eventEmitter.emit('api-ai-instances', `retrieved ${instances.length} instances`);
      res.status(200).json({ success: true, instances, total: instances.length });
    } catch (error) {
      eventEmitter.emit('api-ai-instances-error', error.message);
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  /**
   * Builds a status handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createStatusHandler = (svc) => (req, res) => {
    const status = svc.enabled !== false ? 'ai api running' : 'ai api disabled - no api key';
    eventEmitter.emit('api-ai-status', status);
    res.status(200).json({
      status,
      provider: svc.constructor.name,
      enabled: svc.enabled !== false,
      hasApiKey: !!svc.client_
    });
  };

  /**
   * Builds a prompt handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createPromptHandler = (svc) => async (req, res) => {
    try {
      if (svc.enabled === false) {
        return res.status(503).json({
          error: 'AI service is disabled - API key not configured',
          enabled: false
        });
      }

      const { prompt, options: promptOpts = {}, username } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required and must be a string' });
      }

      const effectiveUsername =
        (username && String(username).trim()) ||
        (promptOpts && typeof promptOpts.username === 'string' && promptOpts.username.trim()) ||
        (req.user && req.user.email) ||
        'anonymous';

      const promptOptions = { ...promptOpts, username: effectiveUsername };

      // Note: the provider's prompt() emits 'ai:prompt:complete', which the
      // matching per-instance Analytics module records. No manual recording here.
      const response = await svc.prompt(prompt, promptOptions);

      if (eventEmitter) {
        eventEmitter.emit('api-ai-prompt', { prompt, username: effectiveUsername, response });
      }

      res.status(200).json(response);
    } catch (error) {
      if (eventEmitter) {
        eventEmitter.emit('api-ai-error', { error: error.message });
      }
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  };

  /**
   * Builds an analytics handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createAnalyticsHandler = (svc) => (req, res) => {
    try {
      const limit = capLimit(parseInt(req.query.limit, 10));
      const recentLimit = capLimit(parseInt(req.query.recentLimit, 10));
      const svcAnalytics = analyticsFor(svc);
      let payload;

      if (svcAnalytics) {
        payload = svcAnalytics.getAnalytics({
          limit: Number.isNaN(limit) ? undefined : limit,
          recentLimit: Number.isNaN(recentLimit) ? undefined : recentLimit
        });
      } else if (typeof svc.getAnalytics === 'function') {
        payload = svc.getAnalytics();
      } else {
        payload = {};
      }

      if (eventEmitter) {
        eventEmitter.emit('api-ai-analytics', payload);
      }
      res.status(200).json(payload);
    } catch (error) {
      if (eventEmitter) {
        eventEmitter.emit('api-ai-error', { error: error.message });
      }
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  };

  /**
   * Builds a models handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createModelsHandler = (svc) => async (req, res) => {
    try {
      if (typeof svc.listModels === 'function') {
        const models = await svc.listModels();
        eventEmitter.emit('api-ai-models', models);
        res.status(200).json({ models });
      } else {
        res.status(200).json({
          message: 'Model listing not supported by this provider',
          currentModel: svc.model_
        });
      }
    } catch (error) {
      eventEmitter.emit('api-ai-error', { error: error.message });
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  };

  /**
   * Builds a health handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createHealthHandler = (svc) => async (req, res) => {
    try {
      if (typeof svc.isRunning === 'function') {
        const isRunning = await svc.isRunning();
        res.status(200).json({ healthy: isRunning, provider: svc.constructor.name });
      } else {
        res.status(200).json({ healthy: true, provider: svc.constructor.name });
      }
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  };

  // ─── Train handlers ────────────────────────────────────────────────────────

  /**
   * Returns whether this provider supports training and, if so, the current
   * training pipeline state. Non-trainable providers return 501 + explanation.
   */
  const createTrainStatusHandler = (svc) => async (req, res) => {
    if (typeof svc.addData !== 'function') {
      return res.status(501).json({
        supported: false,
        provider: svc.constructor.name,
        error: `${svc.constructor.name} does not support training. ` +
          'Training is only available for providers that implement local model training (e.g. TensorFlow).'
      });
    }
    try {
      const status = svc.getTrainingStatus();
      res.status(200).json({ supported: true, ...status });
    } catch (err) {
      sendSafeError(res, err, { status: 500, eventEmitter });
    }
  };

  /** Returns all training documents in the data store. */
  const createGetTrainDataHandler = (svc) => async (req, res) => {
    if (typeof svc.getData !== 'function') {
      return res.status(501).json({ supported: false, error: 'Not supported by this provider' });
    }
    try {
      const documents = await svc.getData();
      res.status(200).json({ documents, total: Object.keys(documents).length });
    } catch (err) {
      sendSafeError(res, err, { status: 500, eventEmitter });
    }
  };

  /** Adds or updates a training document. Body: { key, text } */
  const createAddTrainDataHandler = (svc) => async (req, res) => {
    if (typeof svc.addData !== 'function') {
      return res.status(501).json({ supported: false, error: 'Not supported by this provider' });
    }
    const { key, text } = req.body || {};
    if (!key || typeof key !== 'string' || !key.trim()) {
      return res.status(400).json({ error: 'key is required and must be a non-empty string' });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required and must be a non-empty string' });
    }
    try {
      const result = await svc.addData(key.trim(), text.trim());
      if (eventEmitter) eventEmitter.emit('api-ai-train-add', { key, length: text.length });
      res.status(200).json(result);
    } catch (err) {
      sendSafeError(res, err, { status: 400, eventEmitter });
    }
  };

  /** Removes a training document by key. */
  const createDeleteTrainDataHandler = (svc) => async (req, res) => {
    if (typeof svc.removeData !== 'function') {
      return res.status(501).json({ supported: false, error: 'Not supported by this provider' });
    }
    const { key } = req.params;
    try {
      const removed = await svc.removeData(key);
      if (!removed) {
        return res.status(404).json({ error: `No document found with key: ${key}` });
      }
      if (eventEmitter) eventEmitter.emit('api-ai-train-delete', { key });
      res.status(200).json({ success: true, key });
    } catch (err) {
      sendSafeError(res, err, { status: 500, eventEmitter });
    }
  };

  /**
   * Builds a get-settings handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createGetSettingsHandler = (svc) => async (req, res) => {
    try {
      const settings = await svc.getSettings();
      res.status(200).json(settings);
    } catch (err) {
      eventEmitter.emit('api-ai-settings-error', err.message);
      res.status(500).json({ error: 'Failed to retrieve settings' });
    }
  };

  /**
   * Builds a save-settings handler bound to a specific service instance.
   * @param {Object} svc - AI service instance.
   * @return {Function} Express route handler.
   */
  const createPostSettingsHandler = (svc) => async (req, res) => {
    const message = req.body;
    if (message) {
      try {
        await svc.saveSettings(message);
        res.status(200).send('OK');
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
      }
    } else {
      res.status(400).send('Bad Request: Missing settings');
    }
  };

  // Default-instance routes.
  app.get('/services/ai/api/status', createStatusHandler(aiService));
  app.post('/services/ai/api/prompt', createPromptHandler(aiService));

  // Shared-module endpoints (feature 02). Legacy providers answer 501.
  const requireMessages = (req, res) => {
    const { messages, maxTokens } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
      res.status(400).json({ success: false, error: 'messages must be a list of 1 to 200 items' });
      return false;
    }
    if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
      res.status(400).json({ success: false, error: 'maxTokens must be a positive whole number' });
      return false;
    }
    return true;
  };
  const sharedOnly = (method, res) => {
    if (typeof aiService[method] === 'function') return true;
    res.status(501).json({ success: false, error: `${method}() is not available for this AI provider` });
    return false;
  };

  app.post('/services/ai/api/complete', async (req, res) => {
    if (!sharedOnly('complete', res) || !requireMessages(req, res)) return;
    try {
      const reply = await aiService.complete(req.body);
      res.json({ success: true, data: { text: reply.text, toolCalls: reply.toolCalls, stopReason: reply.stopReason, usage: reply.usage, model: reply.model } });
    } catch (err) {
      sendSafeError(res, err, { status: 500 });
    }
  });

  app.post('/services/ai/api/stream', async (req, res) => {
    if (!sharedOnly('streamToResponse', res) || !requireMessages(req, res)) return;
    await aiService.streamToResponse(res, req.body);
  });

  app.post('/services/ai/api/generate-object', async (req, res) => {
    if (!sharedOnly('generateObject', res) || !requireMessages(req, res)) return;
    try {
      res.json({ success: true, data: await aiService.generateObject(req.body) });
    } catch (err) {
      sendSafeError(res, err, { status: 500 });
    }
  });

  app.post('/services/ai/api/embed', async (req, res) => {
    if (!sharedOnly('embed', res)) return;
    const texts = req.body?.texts;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 100) {
      return res.status(400).json({ success: false, error: 'texts must be a list of 1 to 100 strings' });
    }
    try {
      res.json({ success: true, data: await aiService.embed(texts, req.body.options || {}) });
    } catch (err) {
      sendSafeError(res, err, { status: 500 });
    }
  });
  app.get('/services/ai/api/analytics', createAnalyticsHandler(aiService));
  app.get('/services/ai/api/models', createModelsHandler(aiService));
  app.get('/services/ai/api/health', createHealthHandler(aiService));
  app.get('/services/ai/api/settings', createGetSettingsHandler(aiService));
  app.post('/services/ai/api/settings', createPostSettingsHandler(aiService));
  app.get('/services/ai/api/train/status', createTrainStatusHandler(aiService));
  app.get('/services/ai/api/train/data', createGetTrainDataHandler(aiService));
  app.post('/services/ai/api/train/data', createAddTrainDataHandler(aiService));
  app.delete('/services/ai/api/train/data/:key', createDeleteTrainDataHandler(aiService));

  // Instance-aware routes - resolve the named instance per request.
  app.get('/services/ai/api/:instanceName/status', (req, res) =>
    createStatusHandler(resolveInstance(req.params.instanceName))(req, res));
  app.post('/services/ai/api/:instanceName/prompt', (req, res) =>
    createPromptHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/analytics', (req, res) =>
    createAnalyticsHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/models', (req, res) =>
    createModelsHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/health', (req, res) =>
    createHealthHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/settings', (req, res) =>
    createGetSettingsHandler(resolveInstance(req.params.instanceName))(req, res));
  app.post('/services/ai/api/:instanceName/settings', (req, res) =>
    createPostSettingsHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/train/status', (req, res) =>
    createTrainStatusHandler(resolveInstance(req.params.instanceName))(req, res));
  app.get('/services/ai/api/:instanceName/train/data', (req, res) =>
    createGetTrainDataHandler(resolveInstance(req.params.instanceName))(req, res));
  app.post('/services/ai/api/:instanceName/train/data', (req, res) =>
    createAddTrainDataHandler(resolveInstance(req.params.instanceName))(req, res));
  app.delete('/services/ai/api/:instanceName/train/data/:key', (req, res) =>
    createDeleteTrainDataHandler(resolveInstance(req.params.instanceName))(req, res));
};
