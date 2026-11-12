/**
 * @fileoverview `nooblyjs keys generate`: a new API key, in the registry's format.
 * @module cli/commands/keys
 */

'use strict';

module.exports = {
  /**
   * @param {Array<string>} argv
   * @param {Object} io
   * @param {Function} parseArgs
   * @return {Promise<number>}
   */
  async run(argv, io, parseArgs) {
    const [sub] = argv;
    if (sub !== 'generate') {
      io.stderr.write('Usage: nooblyjs keys generate [--length 32]\n');
      return 2;
    }
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { length: { type: 'string', default: '32' } },
      allowPositionals: false
    });
    const length = Number(values.length);
    if (!Number.isInteger(length) || length < 32 || length > 128) {
      io.stderr.write('--length must be a whole number from 32 to 128\n');
      return 2;
    }
    const serviceRegistry = require('../../../index');
    io.stdout.write(`${serviceRegistry.generateApiKey(length)}\n`);
    return 0;
  }
};
