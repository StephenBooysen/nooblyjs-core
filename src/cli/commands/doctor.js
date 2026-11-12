/**
 * @fileoverview `nooblyjs doctor`: checks an app's environment and dependencies
 * before it runs. Exits 1 when a check fails, so CI can gate on it. Production
 * (NODE_ENV=production) turns the environment warnings into failures.
 * @module cli/commands/doctor
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Runs the checks.
 * @param {{dir: string, env: Object, skipAudit: boolean, spawn: Function}} input
 * @return {Array<{name: string, status: 'pass'|'warn'|'fail', detail: string}>}
 */
function runChecks({ dir, env, skipAudit, spawn }) {
  const checks = [];
  const production = env.NODE_ENV === 'production';
  const add = (name, status, detail) => checks.push({ name, status, detail });
  /** A missing requirement fails in production and only warns in development. */
  const requirement = (ok, name, detail) => add(name, ok ? 'pass' : (production ? 'fail' : 'warn'), detail);

  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js version', major >= 20 ? 'pass' : 'fail', `Node ${process.versions.node} (needs 20 or later)`);

  const session = env.SESSION_SECRET || '';
  requirement(session.length >= 32, 'SESSION_SECRET', session ? (session.length >= 32 ? 'set' : 'too short; use at least 32 characters') : 'not set');
  const keys = (env.API_KEYS || env.NOOBLYJS_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  requirement(keys.length > 0, 'API keys', keys.length ? `${keys.length} configured` : 'API_KEYS is not set');
  requirement(Boolean(env.SETTINGS_SECRET), 'SETTINGS_SECRET', env.SETTINGS_SECRET ? 'set' : 'not set (settings use a development secret)');

  const csp = (env.CSP_MODE || 'enforce').toLowerCase();
  if (csp === 'off') add('CSP_MODE', production ? 'fail' : 'warn', 'off: dashboards are not protected by a Content-Security-Policy');
  else if (csp === 'report-only') add('CSP_MODE', 'warn', 'report-only: violations are logged, not blocked');
  else add('CSP_MODE', 'pass', 'enforce');

  if (env.TRUST_PROXY) add('TRUST_PROXY', 'pass', `set to "${env.TRUST_PROXY}"`);
  else add('TRUST_PROXY', 'warn', 'not set: behind a TLS proxy, secure cookies and client IPs need it');

  const appDir = path.join(dir, '.application');
  try {
    fs.mkdirSync(appDir, { recursive: true });
    const probe = path.join(appDir, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    add('.application is writable', 'pass', appDir);
  } catch (error) {
    add('.application is writable', 'fail', `${appDir}: ${error.code || error.message}`);
  }

  if (!skipAudit) {
    const result = spawn('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: dir, encoding: 'utf8' });
    if (result.error) {
      add('npm audit (production dependencies)', 'warn', `could not run npm: ${result.error.message}`);
    } else if (result.status === 0) {
      add('npm audit (production dependencies)', 'pass', 'no high or critical advisories');
    } else {
      const summary = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n').slice(-3).join(' ');
      add('npm audit (production dependencies)', 'fail', summary || 'advisories found');
    }
  }
  return checks;
}

module.exports = {
  runChecks,
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
        dir: { type: 'string' },
        'skip-audit': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false }
      },
      allowPositionals: false
    });
    const dir = path.resolve(io.cwd, values.dir || '.');
    const checks = runChecks({
      dir,
      env: io.env,
      skipAudit: values['skip-audit'],
      spawn: spawnSync
    });
    const failed = checks.some((c) => c.status === 'fail');
    if (values.json) {
      io.stdout.write(`${JSON.stringify({ ok: !failed, checks }, null, 2)}\n`);
    } else {
      const mark = { pass: '[ok]  ', warn: '[warn]', fail: '[FAIL]' };
      for (const c of checks) io.stdout.write(`${mark[c.status]} ${c.name}: ${c.detail}\n`);
      io.stdout.write(failed ? '\nSome checks failed.\n' : '\nAll required checks passed.\n');
    }
    return failed ? 1 : 0;
  }
};
