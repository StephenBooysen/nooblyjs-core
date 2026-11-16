/**
 * @fileoverview Tests for route patterns that work on Express 4 and Express 5
 * host apps: the compiled RegExp matches what Express 4's own pattern matched,
 * and req.params keeps its Express 4 shape.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const pathToRegexp = require('path-to-regexp-v0'); // Express 4's matcher (0.1.x), kept as a dev alias
const { route, compileRoute } = require('../../../src/shared/utils/routePattern');

/** Every pattern the service routes pass to route(), with paths to try. */
const CASES = [
  ['/services/filing/api/upload/*', ['/services/filing/api/upload/a.txt', '/services/filing/api/upload/dir/sub/a.txt', '/services/filing/api/upload/', '/services/filing/api/upload', '/services/filing/api/uploadx/a', '/SERVICES/filing/api/upload/a']],
  ['/services/filing/api/:instanceName/download/*', ['/services/filing/api/main/download/a/b.txt', '/services/filing/api/main/download/', '/services/filing/api/a/b/download/c', '/services/filing/api/main/download']],
  ['/services/filing/api/:instanceName/browse/*', ['/services/filing/api/main/browse/', '/services/filing/api/main/browse/docs/']],
  ['/services/searching/api/search/:searchContainer?', ['/services/searching/api/search', '/services/searching/api/search/', '/services/searching/api/search/docs', '/services/searching/api/search/docs/', '/services/searching/api/search/a/b']],
  ['/services/workflow/api/definitions/:workflowName(*)', ['/services/workflow/api/definitions/flow', '/services/workflow/api/definitions/team/flow', '/services/workflow/api/definitions/']],
  ['/services/workflow/api/executions/:workflowName(*)/execution/:executionId(*)', ['/services/workflow/api/executions/team/flow/execution/abc', '/services/workflow/api/executions/flow/execution/a/b', '/services/workflow/api/executions/flow']],
  ['/services/workflow/api/executions/:workflowName(*)/stats', ['/services/workflow/api/executions/team/flow/stats', '/services/workflow/api/executions/stats']],
];

describe('compileRoute', () => {
  it.each(CASES)('%s matches the same paths as Express 4', (pattern, paths) => {
    const express4 = pathToRegexp(pattern, [], { sensitive: false, strict: false, end: true });
    const { regexp } = compileRoute(pattern);
    for (const p of paths) {
      expect([p, regexp.test(p)]).toEqual([p, express4.test(p)]);
    }
  });

  it('rejects segments it does not understand', () => {
    expect(() => compileRoute('/a/:id(\\d+)')).toThrow(/Unsupported route segment/);
    expect(() => compileRoute('/a/b*')).toThrow(/Unsupported route segment/);
  });

  it('escapes literal segments', () => {
    expect(compileRoute('/a.b/*').regexp.test('/axb/c')).toBe(false);
  });
});

describe('route', () => {
  const app = express();
  const echo = (req, res) => res.json({ ...req.params });
  app.get(...route('/files/:instanceName/download/*'), echo);
  app.get(...route('/files/browse/*'), echo);
  app.post(...route('/search/:container?'), echo);
  app.get(...route('/runs/:flow(*)/execution/:id(*)'), (req, res, next) => next(), echo);

  it('names params and keeps the wildcard as req.params[0], decoded', async () => {
    const res = await request(app).get('/files/main/download/dir/a%20b.txt');
    expect(res.body).toEqual({ instanceName: 'main', 0: 'dir/a b.txt' });
    expect((await request(app).get('/files/browse/')).body).toEqual({ 0: '' });
  });

  it('leaves a missing optional param out', async () => {
    expect((await request(app).post('/search')).body).toEqual({});
    expect((await request(app).post('/search/docs')).body).toEqual({ container: 'docs' });
  });

  it('keeps the names for every handler of the route', async () => {
    const res = await request(app).get('/runs/team/flow/execution/x1');
    expect(res.body).toEqual({ flow: 'team/flow', id: 'x1' });
  });
});
