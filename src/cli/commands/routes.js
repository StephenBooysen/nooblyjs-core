/**
 * @fileoverview `nooblyjs routes --url <base>`: lists the API routes of a running
 * app with the credentials each one needs, from its OpenAPI document.
 * @module cli/commands/routes
 */

'use strict';

const { fetchDocument, credentialOf } = require('../http');

module.exports = {
  /**
   * @param {Array<string>} argv
   * @param {Object} io
   * @param {Function} parseArgs
   * @return {Promise<number>}
   */
  async run(argv, io, parseArgs) {
    const { values } = parseArgs({
      args: argv,
      options: {
        url: { type: 'string' },
        key: { type: 'string' },
        json: { type: 'boolean', default: false }
      },
      allowPositionals: false
    });
    if (!values.url) {
      io.stderr.write('Usage: nooblyjs routes --url <base-url> [--key <api-key>] [--json]\n');
      return 2;
    }
    const doc = await fetchDocument(io, values.url, values.key || io.env.NOOBLYJS_API_KEY);
    const rows = [];
    for (const [route, item] of Object.entries(doc.paths || {})) {
      for (const [method, op] of Object.entries(item)) {
        rows.push({ method: method.toUpperCase(), path: route, auth: credentialOf(op), summary: op.summary || '' });
      }
    }
    rows.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
    if (values.json) {
      io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return 0;
    }
    const width = (key) => Math.max(key.length, ...rows.map((r) => String(r[key]).length));
    const wm = width('method');
    const wp = width('path');
    const wa = width('auth');
    io.stdout.write(`${'METHOD'.padEnd(wm)}  ${'PATH'.padEnd(wp)}  ${'AUTH'.padEnd(wa)}  SUMMARY\n`);
    for (const r of rows) {
      io.stdout.write(`${r.method.padEnd(wm)}  ${r.path.padEnd(wp)}  ${r.auth.padEnd(wa)}  ${r.summary}\n`);
    }
    io.stdout.write(`\n${rows.length} routes\n`);
    return 0;
  }
};
