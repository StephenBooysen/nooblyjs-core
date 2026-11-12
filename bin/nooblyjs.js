#!/usr/bin/env node
/**
 * @fileoverview The `nooblyjs` command (feature 09). See `nooblyjs --help`.
 */

'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`nooblyjs: ${error.message}\n`);
    process.exitCode = 1;
  }
);
