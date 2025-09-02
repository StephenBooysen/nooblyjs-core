/**
 * @fileoverview AI API routes for Express.js application.
 * Provides RESTful endpoints for AI operations, prompt processing, and analytics retrieval.
 * 
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers AI service routes with the Express application.
 * Sets up endpoints for AI operations and monitoring.
 * 
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} aiService - The AI provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, aiService) => {
  if (options['express-app'] && aiService) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;

    /**
     * GET /services/ai/api/status
     * Returns the operational status of the AI service.
     */
    app.get('/services/ai/api/status', (req, res) => {
      eventEmitter.emit('api-ai-status', 'ai api running');
      res.status(200).json({ status: 'ai api running', provider: aiService.constructor.name });
    });

    /**
     * POST /services/ai/api/prompt
     * Sends a prompt to the AI service and returns the response.
     */
    app.post('/services/ai/api/prompt', async (req, res) => {
      try {
        const { prompt, options = {} } = req.body;
        
        if (!prompt || typeof prompt !== 'string') {
          return res.status(400).json({ error: 'Prompt is required and must be a string' });
        }

        const response = await aiService.prompt(prompt, options);
        eventEmitter.emit('api-ai-prompt', { prompt, response });
        res.status(200).json(response);
      } catch (error) {
        eventEmitter.emit('api-ai-error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/ai/api/analytics
     * Returns analytics data for the AI service.
     */
    app.get('/services/ai/api/analytics', (req, res) => {
      try {
        const analytics = aiService.getAnalytics();
        eventEmitter.emit('api-ai-analytics', analytics);
        res.status(200).json(analytics);
      } catch (error) {
        eventEmitter.emit('api-ai-error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/ai/api/models
     * Returns available models (for Ollama provider).
     */
    app.get('/services/ai/api/models', async (req, res) => {
      try {
        if (typeof aiService.listModels === 'function') {
          const models = await aiService.listModels();
          eventEmitter.emit('api-ai-models', models);
          res.status(200).json({ models });
        } else {
          res.status(200).json({ 
            message: 'Model listing not supported by this provider',
            currentModel: aiService.model_ 
          });
        }
      } catch (error) {
        eventEmitter.emit('api-ai-error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/ai/api/health
     * Health check endpoint (for Ollama provider).
     */
    app.get('/services/ai/api/health', async (req, res) => {
      try {
        if (typeof aiService.isRunning === 'function') {
          const isRunning = await aiService.isRunning();
          res.status(200).json({ 
            healthy: isRunning,
            provider: aiService.constructor.name 
          });
        } else {
          res.status(200).json({ 
            healthy: true,
            provider: aiService.constructor.name 
          });
        }
      } catch (error) {
        res.status(500).json({ 
          healthy: false,
          error: error.message 
        });
      }
    });

  }
};
