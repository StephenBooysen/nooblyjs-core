/**
 * @fileoverview Jest setup: point library defaults that write to disk at
 * `.temp/tests/data/`, so a test run leaves nothing outside `.temp/`
 * (see `.claude/rules/output-locations.md`, review finding L-2).
 */

'use strict';

const path = require('node:path');

process.env.NOOBLYJS_DATA_DIR = process.env.NOOBLYJS_DATA_DIR
  || path.join(__dirname, '../../.temp/tests/data');
