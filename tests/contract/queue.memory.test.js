'use strict';

/**
 * Runs the queueing contract against the memory provider (always on in npm test).
 */
const { EventEmitter } = require('events');
const { runQueueContract } = require('./queue.contract');
const createQueue = require('../../src/queueing');

runQueueContract('memory', () => createQueue('memory', { dependencies: {} }, new EventEmitter()));
