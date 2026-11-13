/**
 * @fileoverview REST routes for the knowledge service (feature 05).
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('../../shared/utils/validation');
const { sendSafeError } = require('../../shared/utils/safeError');

/**
 * Mounts the knowledge routes on the Express app in options['express-app'].
 *
 * @param {Object} options Factory options (express-app, authMiddleware)
 * @param {EventEmitter} eventEmitter Shared emitter
 * @param {Object} knowledge KnowledgeBase instance
 * @return {void}
 */
/**
 * Roles of the caller, for access control. An unrestricted key (scopes null) and
 * an administrator both count as `*`. A signed-in user keeps the roles on the session.
 * @param {Object} options Factory options (resolvePrincipal)
 * @param {Object} req Express request
 * @return {Promise<string[]>}
 */
async function rolesOf(options, req) {
  const principal = options.resolvePrincipal ? await options.resolvePrincipal(req) : null;
  if (!principal) return [];
  if (principal.scopes === null) return ['*'];
  if (Array.isArray(principal.roles)) return principal.roles;
  return Array.isArray(principal.scopes) && principal.scopes.includes('*') ? ['*'] : [];
}

module.exports = (options, eventEmitter, knowledge) => {
  const app = options['express-app'];
  if (!app || !knowledge) return;

  app.get('/services/knowledge/api/swagger/docs.json', (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(fs.readFileSync(path.join(__dirname, 'swagger', 'docs.json'), 'utf8'));
    } catch (err) {
      sendSafeError(res, err, { status: 500, eventEmitter });
    }
  });

  app.get('/services/knowledge/api/status', (req, res) => {
    res.status(200).json({ success: true, data: knowledge.status() });
  });

  app.post(
    '/services/knowledge/api/sync',
    validate({ body: { directory: { type: 'string', maxLength: 500 } } }),
    async (req, res) => {
      try {
        const stats = await knowledge.sync({ directory: req.body?.directory || '/' });
        res.status(200).json({ success: true, data: stats });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );

  app.post(
    '/services/knowledge/api/retrieve',
    validate({ body: { question: { type: 'string', required: true, minLength: 1, maxLength: 1000 }, k: { type: 'integer' } } }),
    async (req, res) => {
      try {
        const hits = await knowledge.retrieve(req.body.question, { k: req.body.k, roles: await rolesOf(options, req) });
        res.status(200).json({ success: true, data: hits });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );

  app.post(
    '/services/knowledge/api/ask',
    validate({ body: { question: { type: 'string', required: true, minLength: 1, maxLength: 1000 }, k: { type: 'integer' } } }),
    async (req, res) => {
      try {
        const answer = await knowledge.ask(req.body.question, { k: req.body.k, roles: await rolesOf(options, req) });
        eventEmitter?.emit?.('knowledge:asked', { confidence: answer.confidence, citations: answer.citations.length });
        res.status(200).json({ success: true, data: answer });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );
};
