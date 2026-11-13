/**
 * @fileoverview Every built-in /services/*\/api route declares a permission (feature 19).
 */
'use strict';

const path = require('path');
const express = require('express');
const { EventEmitter } = require('events');
const registry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { RouteDeclarations, findUndeclaredRoutes, listApiRoutes } = require('../../../src/authservice/modules/routeDeclarations');

describe('route permission declarations (feature 19)', () => {
  let app;
  beforeAll(() => {
    const dir = testDataDir('route-declarations');
    app = express();
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], security: { servicesAuth: { requireLogin: false } } });
    registry.logger('memory'); registry.cache('memory'); registry.fetching('node');
    registry.filing('local', { baseDir: path.join(dir, 'files') }); registry.queue('memory');
    registry.scheduling('memory'); registry.searching('memory'); registry.measuring('memory');
    registry.notifying('memory'); registry.working('memory'); registry.workflow('memory');
    registry.settings('file', { filepath: path.join(dir, 'settings.json'), secret: 'x'.repeat(32) });
    registry.aiservice('mock', {}); registry.authservice('memory', {}); registry.dataService('memory');
  });
  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  it('finds the API routes, including route() wildcard routes', () => {
    const routes = listApiRoutes(app);
    expect(routes.length).toBeGreaterThan(250);
    expect(routes.some((r) => r.pattern === '/services/filing/api/upload/*')).toBe(true);
  });

  it('has no undeclared routes', () => {
    expect(findUndeclaredRoutes(app, new RouteDeclarations())).toEqual([]);
  });

  it('matches requests to the most specific declaration, named instances included', () => {
    const d = new RouteDeclarations();
    expect(d.forRequest('POST', '/services/working/api/run')).toBe('jobs:run');
    expect(d.forRequest('GET', '/services/caching/api/other/list')).toBe('caching:read');
    expect(d.forRequest('POST', '/services/filing/api/settings')).toBe('settings:manage');
    expect(d.forRequest('GET', '/services/dataservice/api/count/users')).toBe('dataservice:read');
    expect(d.forRequest('GET', '/services/nope/api/x')).toBeNull();
  });
});
