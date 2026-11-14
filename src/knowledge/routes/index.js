/**
 * @fileoverview REST routes for the knowledge service (feature 05): sync, retrieve,
 * ask (whole or streamed), sources, feedback and evaluation, plus the dashboard
 * at /services/knowledge/.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { validate, parseLimit } = require('../../shared/utils/validation');
const { sendSafeError } = require('../../shared/utils/safeError');
const { ClientError } = require('../../shared/utils/httpErrors');
const { MAX_CASES } = require('../modules/evaluate');

const QUESTION = { type: 'string', required: true, minLength: 1, maxLength: 1000 };
const K = { type: 'integer', min: 1, max: 20 };

/**
 * The caller as the auth layer sees it, or null.
 * @param {Object} options Factory options (resolvePrincipal)
 * @param {Object} req Express request
 * @return {Promise<?Object>}
 */
async function principalOf(options, req) {
  return options.resolvePrincipal ? options.resolvePrincipal(req) : null;
}

/**
 * Roles of the caller, for access control. An unrestricted key (scopes null) and
 * an administrator both count as `*`. A signed-in user keeps the roles on the session.
 * @param {?Object} principal From principalOf()
 * @return {string[]}
 */
function rolesOf(principal) {
  if (!principal) return [];
  if (principal.scopes === null) return ['*'];
  if (Array.isArray(principal.roles)) return principal.roles;
  return Array.isArray(principal.scopes) && principal.scopes.includes('*') ? ['*'] : [];
}

/**
 * Mounts the knowledge routes and dashboard on the Express app in options['express-app'].
 *
 * @param {Object} options Factory options (express-app, resolvePrincipal)
 * @param {EventEmitter} eventEmitter Shared emitter
 * @param {Object} knowledge KnowledgeBase instance
 * @return {void}
 */
module.exports = (options, eventEmitter, knowledge) => {
  const app = options['express-app'];
  if (!app || !knowledge) return;

  app.use('/services/knowledge', express.static(path.join(__dirname, '..', 'views')));

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

  app.get('/services/knowledge/api/sources', async (req, res) => {
    try {
      const sources = knowledge.sources({ roles: rolesOf(await principalOf(options, req)) });
      res.status(200).json({ success: true, data: sources });
    } catch (err) {
      sendSafeError(res, err, { status: 500, eventEmitter });
    }
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
    validate({ body: { question: QUESTION, k: K } }),
    async (req, res) => {
      try {
        const roles = rolesOf(await principalOf(options, req));
        const hits = await knowledge.retrieve(req.body.question, { k: req.body.k, roles });
        res.status(200).json({ success: true, data: hits });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );

  app.post(
    '/services/knowledge/api/ask',
    validate({ body: { question: QUESTION, k: K } }),
    async (req, res) => {
      try {
        const roles = rolesOf(await principalOf(options, req));
        const answer = await knowledge.ask(req.body.question, { k: req.body.k, roles });
        eventEmitter?.emit?.('knowledge:asked', { confidence: answer.confidence, citations: answer.citations.length });
        res.status(200).json({ success: true, data: answer });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );

  app.post(
    '/services/knowledge/api/ask/stream',
    validate({ body: { question: QUESTION, k: K } }),
    async (req, res) => {
      let roles;
      try {
        roles = rolesOf(await principalOf(options, req));
      } catch (err) {
        return sendSafeError(res, err, { status: 500, eventEmitter });
      }
      const done = await knowledge.askStream(res, req.body.question, { k: req.body.k, roles });
      if (done) eventEmitter?.emit?.('knowledge:asked', { confidence: done.confidence, citations: done.citations.length, streamed: true });
    }
  );

  app.post(
    '/services/knowledge/api/feedback',
    validate({
      body: {
        question: QUESTION,
        rating: { type: 'string', required: true, enum: ['good', 'bad'] },
        answer: { type: 'string', maxLength: 4000 },
        citations: { type: 'array', maxLength: 20 },
        comment: { type: 'string', maxLength: 1000 }
      }
    }),
    async (req, res) => {
      try {
        const principal = await principalOf(options, req);
        const item = await knowledge.recordFeedback({
          question: req.body.question,
          rating: req.body.rating,
          answer: req.body.answer,
          citations: (req.body.citations || []).filter((c) => typeof c === 'string' && c.length <= 500),
          comment: req.body.comment,
          user: principal?.principal || null
        });
        res.status(201).json({ success: true, data: { id: item.id } });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );

  app.get(
    '/services/knowledge/api/feedback',
    validate({ query: { rating: { type: 'string', enum: ['good', 'bad'] } } }),
    (req, res) => {
      const limit = parseLimit(req.query.limit, { defaultValue: 50, max: 500 });
      res.status(200).json({ success: true, data: knowledge.listFeedback({ rating: req.query.rating, limit }) });
    }
  );

  app.post(
    '/services/knowledge/api/evaluate',
    validate({
      body: {
        cases: { type: 'array', maxLength: MAX_CASES },
        yaml: { type: 'string', maxLength: 200000 },
        fromFeedback: { type: 'boolean' },
        k: K,
        answers: { type: 'boolean' }
      }
    }),
    async (req, res) => {
      try {
        let cases = req.body.yaml ?? req.body.cases;
        if (req.body.fromFeedback) cases = knowledge.feedbackCases();
        if (cases === undefined) throw new ClientError(400, 'Give cases, yaml or fromFeedback');
        if (Array.isArray(cases)) {
          cases.forEach((c, i) => {
            if (!c || typeof c.question !== 'string' || typeof c.expectedPath !== 'string') {
              throw new ClientError(400, `Case ${i + 1} needs a question and an expectedPath`);
            }
          });
        }
        let report;
        try {
          report = await knowledge.evaluate(cases, { k: req.body.k, answers: req.body.answers === true });
        } catch (err) {
          // YAML and case-shape problems are the caller's to fix.
          if (/evaluation case|YAML/.test(err.message)) throw new ClientError(400, err.message);
          throw err;
        }
        res.status(200).json({ success: true, data: report });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    }
  );
};
