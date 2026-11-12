/**
 * @fileoverview `nooblyjs openapi --url <base>`: writes the OpenAPI document of
 * a running app, and optionally a typed TypeScript client (feature 10).
 * @module cli/commands/openapi
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getText } = require('../http');
const { generateTypeScriptClient } = require('../clientgen');

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
        format: { type: 'string', default: 'json' },
        client: { type: 'string' },
        out: { type: 'string' }
      },
      allowPositionals: false
    });
    if (!values.url) {
      io.stderr.write('Usage: nooblyjs openapi --url <base-url> [--format json|yaml] [--client ts] [--out <dir>]\n');
      return 2;
    }
    if (!['json', 'yaml'].includes(values.format)) {
      io.stderr.write('--format must be json or yaml\n');
      return 2;
    }
    if (values.client && values.client !== 'ts') {
      io.stderr.write('--client supports only ts for now (use openapi-generator for other languages)\n');
      return 2;
    }
    const base = values.url.replace(/\/$/, '');
    const key = values.key || io.env.NOOBLYJS_API_KEY;
    const outDir = path.resolve(io.cwd, values.out || '.');
    fs.mkdirSync(outDir, { recursive: true });

    const jsonText = await getText(io, `${base}/services/api/openapi.json`, key);
    const doc = JSON.parse(jsonText);
    const written = [];
    if (values.format === 'yaml') {
      const yamlText = await getText(io, `${base}/services/api/openapi.yaml`, key);
      const file = path.join(outDir, 'openapi.yaml');
      fs.writeFileSync(file, yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
      written.push(file);
    } else {
      const file = path.join(outDir, 'openapi.json');
      fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
      written.push(file);
    }
    if (values.client === 'ts') {
      const file = path.join(outDir, 'nooblyjs-client.ts');
      fs.writeFileSync(file, generateTypeScriptClient(doc, { title: doc.info?.title }));
      written.push(file);
    }
    for (const file of written) io.stdout.write(`wrote ${file}\n`);
    return 0;
  }
};
