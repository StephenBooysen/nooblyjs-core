'use strict';

/** Runs the dataservice contract against the memory provider (always on in npm test). */
const { EventEmitter } = require('events');
const { runDataserviceContract } = require('./dataservice.contract');
const createDataservice = require('../../src/dataservice');

runDataserviceContract('memory', () => createDataservice('memory', {}, new EventEmitter()));
