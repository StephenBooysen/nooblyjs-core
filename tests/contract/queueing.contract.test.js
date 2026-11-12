/**
 * @fileoverview Contract suite for queueing providers (feature 11). The
 * at-least-once job contract (feature 06) is in
 * tests/unit/queueing/reliableJobs.contract.test.js.
 */

'use strict';

const { queueingContract } = require('../../src/testing/contracts/queueing');
const serviceRegistry = require('../../index');
const { EventEmitter } = require('events');
const express = require('express');

serviceRegistry.reset();
serviceRegistry.initialize(express(), new EventEmitter(), {
  security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
});
afterAll(() => serviceRegistry.reset());

queueingContract('memory', () => serviceRegistry.queue('memory', { instanceName: 'contract-memory' }));
