/**
 * @fileoverview `nooblyjs doctor`: checks an app's environment before it runs or
 * ships (feature 09). The checks read the environment and a few files; they do
 * not open connections to Redis, Mongo or S3 yet.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parse } = require('./index');

/**
 * Runs the environment checks.
 *
 * @param {Object} input
 * @param {Object} input.env Environment variables
 * @param {string} input.nodeVersion Node version, e.g. "v24.1.0"
 * @param {string} input.dir App directory
 * @param {boolean} input.production Whether NODE_ENV is production
 * @param {?Function} input.audit Returns {ok, detail} for `npm audit`, or null to skip
 * @return {Array<{name: string, status: 'ok'|'warn'|'fail', detail: string}>}
 */
function checkEnvironment({ env, nodeVersion, dir, production, audit }) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  if (major >= 22) add('node version', 'ok', `${nodeVersion}`);
  else if (major >= 18) add('node version', 'warn', `${nodeVersion}; Node 22 or later is recommended`);
  else add('node version', 'fail', `${nodeVersion}; Node 18 or later is required`);

  const sessionSecret = env.SESSION_SECRET || '';
  if (sessionSecret.length >= 32) add('SESSION_SECRET', 'ok', 'set');
  else add('SESSION_SECRET', production ? 'fail' : 'warn', sessionSecret ? 'shorter than 32 characters' : 'not set');

  const keys = env.API_KEYS || env.NOOBLYJS_API_KEYS || '';
  if (keys.trim()) add('API keys', 'ok', 'set');
  else add('API keys', production ? 'fail' : 'warn', 'API_KEYS or NOOBLYJS_API_KEYS is not set');

  if (env.SETTINGS_SECRET || env.SESSION_SECRET) add('settings secret', 'ok', 'set');
  else add('settings secret', 'warn', 'neither SETTINGS_SECRET nor SESSION_SECRET is set');

  if (production) {
    add('TRUST_PROXY', env.TRUST_PROXY ? 'ok' : 'warn', env.TRUST_PROXY ? `set to ${env.TRUST_PROXY}` : 'not set; needed behind a TLS-terminating proxy, or Secure cookies are not sent');
  }

  const csp = (env.CSP_MODE || 'enforce').toLowerCase();
  if (csp === 'off') add('CSP mode', production ? 'warn' : 'ok', 'off');
  else if (['enforce', 'report-only'].includes(csp)) add('CSP mode', 'ok', csp);
  else add('CSP mode', 'fail', `"${env.CSP_MODE}" is not enforce, report-only or off`);

  const appDir = path.join(dir, '.application');
  try {
    fs.mkdirSync(appDir, { recursive: true });
    fs.accessSync(appDir, fs.constants.W_OK);
    add('.application directory', 'ok', 'writable');
  } catch (_err) {
    add('.application directory', 'fail', 'cannot create or write to ./.application');
  }

  if (audit) {
    const result = audit();
    add('npm audit (production, high)', result.ok ? 'ok' : 'fail', result.detail);
  } else {
    add('npm audit (production, high)', 'warn', 'skipped with --skip-audit');
  }

  add('provider connectivity', 'warn', 'not checked (Redis, Mongo and S3 are not contacted yet)');
  return checks;
}

/**
 * Runs `npm audit --omit=dev --audit-level=high` in the app directory.
 * @param {string} dir App directory
 * @return {{ok: boolean, detail: string}}
 */
function npmAudit(dir) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  if (result.error) return { ok: false, detail: `could not run npm audit: ${result.error.message}` };
  if (result.status === 0) return { ok: true, detail: 'no high or critical advisories' };
  const summary = (result.stdout || result.stderr || '').trim().split('\n').slice(-1)[0] || 'advisories found';
  return { ok: false, detail: summary };
}

/**
 * Runs `nooblyjs doctor [--skip-audit] [--dir <path>]`.
 *
 * @param {string[]} args Arguments after `doctor`
 * @param {{stdout: Object, env: Object}} io Streams and environment
 * @return {Promise<number>} 0 when no check fails, 1 otherwise
 */
async function run(args, io) {
  const { values } = parse(args, {
    'skip-audit': { type: 'boolean', default: false },
    dir: { type: 'string', default: io.cwd || process.cwd() }
  });
  const env = io.env;
  const dir = path.resolve(values.dir);
  const checks = checkEnvironment({
    env,
    nodeVersion: process.version,
    dir,
    production: env.NODE_ENV === 'production',
    audit: values['skip-audit'] ? null : () => npmAudit(dir)
  });
  for (const c of checks) {
    io.stdout.write(`[${c.status}] ${c.name}: ${c.detail}\n`);
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  io.stdout.write(failed ? `${failed} check(s) failed.\n` : 'All checks passed (warnings are advisory).\n');
  return failed ? 1 : 0;
}

module.exports = { run, checkEnvironment };
