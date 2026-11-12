/**
 * @fileoverview Contract suite for caching providers (feature 11). The memory
 * provider always runs. The Redis provider runs against a real server when
 * REDIS_TEST_URL is set (CI does this) and is skipped otherwise.
 *
 * Locally: docker run -d -p 6379:6379 redis:7-alpine, then
 *          REDIS_TEST_URL=redis://127.0.0.1:6379 npm test -- tests/contract
 */

'use strict';

const { cachingContract } = require('../../src/testing/contracts/caching');
const serviceRegistry = require('../../index');
const { EventEmitter } = require('events');
const express = require('express');

serviceRegistry.reset();
serviceRegistry.initialize(express(), new EventEmitter(), {
  security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
});
afterAll(() => serviceRegistry.reset());

cachingContract('memory', () => serviceRegistry.cache('memory', { instanceName: 'contract-memory' }));

if (process.env.REDIS_TEST_URL) {
  const url = new URL(process.env.REDIS_TEST_URL);
  cachingContract('redis', () => serviceRegistry.cache('redis', {
    instanceName: 'contract-redis',
    redisUrl: url.hostname,
    redisPort: Number(url.port) || 6379,
    keyPrefix: `contract-${Date.now()}:`
  }));
} else {
  describe.skip('caching contract: redis (set REDIS_TEST_URL to run)', () => {});
}
