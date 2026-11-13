'use strict';

/**
 * Runs the filing contract against the local provider, in a temp root under
 * .temp/tests/data/ (always on in npm test).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { runFilingContract } = require('./filing.contract');
const { testDataDir } = require('../helpers/testData');
const createFiling = require('../../src/filing');

let root;
runFilingContract(
  'local',
  () => {
    root = fs.mkdtempSync(path.join(testDataDir('contract'), 'filing-'));
    return createFiling('local', { baseDir: root, dependencies: {} }, new EventEmitter());
  },
  async () => { fs.rmSync(root, { recursive: true, force: true }); }
);
