'use strict';

/**
 * Runs the dataservice contract against the file provider, in a temp folder
 * under .temp/tests/data/ (always on in npm test).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { runDataserviceContract } = require('./dataservice.contract');
const { testDataDir } = require('../helpers/testData');
const createDataservice = require('../../src/dataservice');

let dir;
runDataserviceContract(
  'file',
  () => {
    dir = fs.mkdtempSync(path.join(testDataDir('contract'), 'dataservice-'));
    return createDataservice('file', { dataDir: dir }, new EventEmitter());
  },
  async (ds) => {
    await ds.provider?.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
);
