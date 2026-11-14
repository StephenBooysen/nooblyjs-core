'use strict';

/** Runs the searching contract against the memory and vector providers (always on in npm test). */
const { EventEmitter } = require('events');
const { runSearchingContract } = require('./searching.contract');
const createSearching = require('../../src/searching');

runSearchingContract('memory', () => createSearching('memory', {}, new EventEmitter(), {}));
runSearchingContract('vector', () => createSearching('vector', { embedding: { backend: 'hash', dimensions: 64 } }, new EventEmitter(), {}));
