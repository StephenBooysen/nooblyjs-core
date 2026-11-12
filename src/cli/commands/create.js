/**
 * @fileoverview `nooblyjs create <dir>`: writes a new app from a template.
 * @module cli/commands/create
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appFiles, TEMPLATES } = require('../templates');

const CORE_VERSION = `^${require('../../../package.json').version}`;

/** Turns a directory name into a valid npm package name. */
function packageNameFor(dir) {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'nooblyjs-app';
}

module.exports = {
  /**
   * @param {Array<string>} argv Arguments after `create`
   * @param {Object} io Streams and cwd
   * @param {Function} parseArgs node:util parseArgs
   * @return {Promise<number>}
   */
  async run(argv, io, parseArgs) {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        template: { type: 'string', default: 'api' },
        force: { type: 'boolean', default: false }
      },
      allowPositionals: true
    });
    const [dir] = positionals;
    if (!dir) {
      io.stderr.write(`Usage: nooblyjs create <dir> [--template ${TEMPLATES.join('|')}] [--force]\n`);
      return 2;
    }
    if (!TEMPLATES.includes(values.template)) {
      io.stderr.write(`Unknown template "${values.template}". Use one of: ${TEMPLATES.join(', ')}\n`);
      return 2;
    }
    const target = path.resolve(io.cwd, dir);
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !values.force) {
      io.stderr.write(`${dir} is not empty. Choose another directory, or pass --force.\n`);
      return 1;
    }

    const files = appFiles(packageNameFor(dir), values.template, CORE_VERSION);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(target, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    io.stdout.write(`Created ${dir} (template: ${values.template}).\n`);
    io.stdout.write(`\nNext:\n  cd ${dir}\n  npm install\n  cp .env.example .env   # set API_KEYS\n  npm test\n  npm start\n`);
    return 0;
  }
};
