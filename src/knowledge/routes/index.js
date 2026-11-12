/**
 * @fileoverview REST API for the knowledge service (feature 05).
 *
 *   POST /services/knowledge/api/ask          { question, k? }            → answer with citations
 *   POST /services/knowledge/api/ask/stream   { question, k? }            → SSE: sources, text, done
 *   POST /services/knowledge/api/retrieve     { query, k? }               → passages only
 *   POST /services/knowledge/api/sync                                      → incremental sync
 *   POST /services/knowledge/api/evaluate     { cases: [...], k? }        → retrieval and citation quality
 *   GET  /services/knowledge/api/status
 *   GET  /services/knowledge/api/sources
 *
 * Callers see only the chunks their roles allow (`req.user.roles`). Admins see
 * every role in the index. Anonymous callers see public chunks only.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.11
 */

'use strict';

const { sendSafeError } = require('../../shared/utils/safeError');
const { validate } = require('../../shared/utils/validation');

/**
 * Roles the caller may read with. Admins also read every role in the index.
 * @param {!Object} req
 * @param {!Object} service Knowledge service
 * @return {Array<string>}
 */
function readerRoles(req, service) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
  if (roles.includes('admin')) return ['*', ...service.allRoles()];
  return roles;
}

/**
 * Registers the knowledge routes.
 * @param {Object} options Service options (`express-app`, optional `authMiddleware`)
 * @param {EventEmitter} eventEmitter
 * @param {Object} service Knowledge service
 * @return {void}
 */
module.exports = (options, eventEmitter, service) => {
  if (!options['express-app'] || !service) return;
  const app = options['express-app'];
  const requireApiAuth = options.authMiddleware || ((req, res, next) => next());
  app.use('/services/knowledge/api', requireApiAuth);

  const questionRules = {
    body: {
      question: { type: 'string', required: true, maxLength: 1000 },
      k: { type: 'integer', min: 1, max: 20 }
    }
  };

  app.post('/services/knowledge/api/ask', validate(questionRules), async (req, res) => {
    try {
      const { question, k } = req.body;
      const answer = await service.ask(question, { k, roles: readerRoles(req, service) });
      res.status(200).json(answer);
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  app.post('/services/knowledge/api/ask/stream', validate(questionRules), async (req, res) => {
    try {
      await service.askStream(res, req.body.question, { k: req.body.k, roles: readerRoles(req, service) });
    } catch (error) {
      if (!res.headersSent) sendSafeError(res, error, { status: 500, eventEmitter });
      else res.end();
    }
  });

  app.post('/services/knowledge/api/retrieve', validate({
    body: {
      query: { type: 'string', required: true, maxLength: 1000 },
      k: { type: 'integer', min: 1, max: 50 }
    }
  }), async (req, res) => {
    try {
      const hits = await service.retrieve(req.body.query, { k: req.body.k, roles: readerRoles(req, service) });
      res.status(200).json({ results: hits });
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  app.post('/services/knowledge/api/sync', async (req, res) => {
    try {
      const stats = await service.sync();
      res.status(200).json({ success: true, ...stats });
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  app.post('/services/knowledge/api/evaluate', validate({
    body: {
      cases: { type: 'array', required: true, maxLength: 200 },
      k: { type: 'integer', min: 1, max: 20 }
    }
  }), async (req, res) => {
    try {
      const report = await service.evaluate(req.body.cases, { k: req.body.k });
      res.status(200).json(report);
    } catch (error) {
      sendSafeError(res, error, { status: 500, eventEmitter });
    }
  });

  app.get('/services/knowledge/api/status', (req, res) => {
    res.status(200).json(service.status());
  });

  app.get('/services/knowledge/api/sources', (req, res) => {
    res.status(200).json({ sources: service.sources() });
  });
};
