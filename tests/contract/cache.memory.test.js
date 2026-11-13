'use strict';

const { EventEmitter } = require('events');
const { runCacheContract } = require('./cache.contract');
const createCache = require('../../src/caching');

runCacheContract('memory', () => createCache('memory', { dependencies: {} }, new EventEmitter()));
