/**
 * @fileoverview `nooblyjs keys generate`: prints a random API key (feature 09).
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const crypto = require('node:crypto');
const { parse } = require('./index');

/**
 * Runs `keys generate [--length n]`.
 *
 * @param {string[]} args Arguments after `keys`
 * @param {{stdout: Object}} io Streams
 * @return {Promise<number>} Exit code
 */
async function run(args, io) {
  const { values, positionals } = parse(args, { length: { type: 'string', default: '32' } });
  if (positionals[0] !== 'generate') {
    io.stderr.write('Usage: nooblyjs keys generate [--length <n>]\n');
    return 2;
  }
  const length = Number(values.length);
  if (!Number.isInteger(length) || length < 16 || length > 256) {
    io.stderr.write('--length must be a whole number from 16 to 256\n');
    return 2;
  }
  io.stdout.write(`${crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)}\n`);
  return 0;
}

module.exports = { run };
