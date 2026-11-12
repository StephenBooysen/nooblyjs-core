/**
 * @fileoverview Contract suite for dataservice providers (feature 11).
 */

'use strict';

const path = require('node:path');
const { dataserviceContract } = require('../../src/testing/contracts/dataservice');
const { testDataDir } = require('../helpers/testData');
const serviceRegistry = require('../../index');
const { EventEmitter } = require('events');
const express = require('express');

serviceRegistry.reset();
serviceRegistry.initialize(express(), new EventEmitter(), {
  security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
});
afterAll(() => serviceRegistry.reset());

dataserviceContract('memory', () => serviceRegistry.dataService('memory', { instanceName: 'contract-memory' }));
dataserviceContract('file', () => serviceRegistry.dataService('file', {
  instanceName: 'contract-file',
  dataDir: path.join(testDataDir('contract'), 'dataservice-file')
}));
