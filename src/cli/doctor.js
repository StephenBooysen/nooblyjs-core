/**
 * @fileoverview `nooblyjs doctor`: checks an app's environment before it runs or
 * ships (feature 09). The checks read the environment and a few files, and
 * check that the Redis, MongoDB and S3 endpoints the environment names accept a
 * TCP connection. They do not sign in, and never print credentials.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');
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

  return checks;
}

/**
 * Runs `npm audit --omit=dev --audit-level=high` in the app directory.
 * @param {string} dir App directory
 * @return {{ok: boolean, detail: string}}
 */
/**
 * Opens a TCP connection to check that a host accepts connections.
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs=2000]
 * @return {Promise<{ok: boolean, detail: string}>}
 */
function probeTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok, detail) => {
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timed out'));
    socket.once('connect', () => done(true, 'reachable'));
    socket.once('error', (err) => done(false, err.code || err.message));
  });
}

/**
 * Reads the hosts of a MongoDB connection string without printing credentials.
 * `mongodb://user:pass@h1:27017,h2/db?x=y` gives two hosts; `mongodb+srv://`
 * gives the SRV name to look up.
 *
 * @param {string} raw Connection string
 * @return {{srv: boolean, hosts: Array<{host: string, port: number}>}|null} Null when it is not a MongoDB URL
 */
function parseMongoUrl(raw) {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(raw || '').trim());
  if (!match) return null;
  const srv = match[1] === 'mongodb+srv';
  const hosts = match[2].split(',').filter(Boolean).map((entry) => {
    const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (bracket) return { host: bracket[1], port: Number(bracket[2] || 27017) };
    const [host, port] = entry.split(':');
    return { host, port: Number(port || 27017) };
  });
  return hosts.length && hosts.every((h) => h.host && Number.isInteger(h.port)) ? { srv, hosts } : null;
}

/**
 * Checks MONGODB_URL (or MONGODB_URI): every listed host must accept a TCP
 * connection; for mongodb+srv the SRV record is looked up and its targets probed.
 *
 * @param {Object} env Environment variables
 * @param {Function} probe Connection check
 * @param {Function} resolveSrv DNS SRV lookup
 * @return {Promise<{name: string, status: string, detail: string}>}
 */
async function mongoCheck(env, probe, resolveSrv) {
  const name = 'MongoDB connectivity';
  const key = env.MONGODB_URL ? 'MONGODB_URL' : (env.MONGODB_URI ? 'MONGODB_URI' : null);
  if (!key) return { name, status: 'ok', detail: 'MONGODB_URL not set; not used' };
  const parsed = parseMongoUrl(env[key]);
  if (!parsed) return { name, status: 'fail', detail: `${key} is not a mongodb:// or mongodb+srv:// URL` };
  let targets = parsed.hosts;
  if (parsed.srv) {
    try {
      const records = await resolveSrv(`_mongodb._tcp.${parsed.hosts[0].host}`);
      targets = records.map((r) => ({ host: r.name, port: r.port }));
    } catch (err) {
      return { name, status: 'fail', detail: `SRV lookup for ${parsed.hosts[0].host} failed: ${err.code || 'error'}` };
    }
    if (!targets.length) return { name, status: 'fail', detail: `no SRV records for ${parsed.hosts[0].host}` };
  }
  const results = [];
  for (const target of targets) {
    const result = await probe(target.host, target.port);
    results.push(`${target.host}:${target.port} ${result.ok ? 'reachable' : result.detail}`);
    target.ok = result.ok;
  }
  const reachable = targets.filter((t) => t.ok).length;
  // A replica set works while a majority is up; report a partial outage as a warning.
  const status = reachable === targets.length ? 'ok' : (reachable > 0 ? 'warn' : 'fail');
  return { name, status, detail: results.join(', ') };
}

/**
 * Checks S3: S3_ENDPOINT (MinIO or another S3-compatible store) or, when only
 * S3_BUCKET is set, the AWS regional endpoint for AWS_REGION. Warns when no
 * access key is set (the AWS default credential chain is used then).
 *
 * @param {Object} env Environment variables
 * @param {Function} probe Connection check
 * @return {Promise<Array<{name: string, status: string, detail: string}>>}
 */
async function s3Checks(env, probe) {
  const name = 'S3 connectivity';
  if (!env.S3_ENDPOINT && !env.S3_BUCKET) return [{ name, status: 'ok', detail: 'S3_ENDPOINT and S3_BUCKET not set; not used' }];
  let host;
  let port;
  if (env.S3_ENDPOINT) {
    let url;
    try {
      url = new URL(env.S3_ENDPOINT);
    } catch (_err) {
      return [{ name, status: 'fail', detail: 'S3_ENDPOINT is not a valid URL' }];
    }
    host = url.hostname;
    port = Number(url.port || (url.protocol === 'http:' ? 80 : 443));
  } else {
    const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
    host = `s3.${region}.amazonaws.com`;
    port = 443;
  }
  const result = await probe(host, port);
  const checks = [{ name, status: result.ok ? 'ok' : 'fail', detail: `${host}:${port} ${result.ok ? 'reachable' : result.detail}` }];
  const hasKeys = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  checks.push({
    name: 'S3 credentials',
    status: hasKeys ? 'ok' : 'warn',
    detail: hasKeys ? 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set' : 'no access key set; the AWS default credential chain (instance role, profile) will be used'
  });
  return checks;
}

/**
 * Checks the Redis, MongoDB and S3 endpoints the app is configured with. One
 * that is not set is reported as not used.
 *
 * @param {Object} options
 * @param {Object} options.env Environment variables
 * @param {Function} [options.probe] Connection check, injected by tests
 * @param {Function} [options.resolveSrv] DNS SRV lookup, injected by tests
 * @return {Promise<Array<{name: string, status: string, detail: string}>>}
 */
async function providerChecks({ env, probe = probeTcp, resolveSrv = dns.promises.resolveSrv }) {
  const checks = [];
  for (const [label, key] of [['Redis (cache and queue)', 'REDIS_URL'], ['Redis (sessions)', 'SESSION_REDIS_URL']]) {
    const raw = env[key];
    if (!raw) {
      checks.push({ name: `${label} connectivity`, status: 'ok', detail: `${key} not set; not used` });
      continue;
    }
    let url;
    try {
      url = new URL(raw);
    } catch (_err) {
      checks.push({ name: `${label} connectivity`, status: 'fail', detail: `${key} is not a valid URL` });
      continue;
    }
    const port = Number(url.port || 6379);
    const result = await probe(url.hostname, port);
    checks.push({
      name: `${label} connectivity`,
      status: result.ok ? 'ok' : 'fail',
      detail: `${url.hostname}:${port} ${result.ok ? 'reachable' : result.detail}`
    });
  }
  checks.push(await mongoCheck(env, probe, resolveSrv));
  checks.push(...(await s3Checks(env, probe)));
  return checks;
}

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
  const checks = [
    ...checkEnvironment({
      env,
      nodeVersion: process.version,
      dir,
      production: env.NODE_ENV === 'production',
      audit: values['skip-audit'] ? null : () => npmAudit(dir)
    }),
    ...(await providerChecks({ env }))
  ];
  for (const c of checks) {
    io.stdout.write(`[${c.status}] ${c.name}: ${c.detail}\n`);
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  io.stdout.write(failed ? `${failed} check(s) failed.\n` : 'All checks passed (warnings are advisory).\n');
  return failed ? 1 : 0;
}

module.exports = { run, checkEnvironment, providerChecks, probeTcp, parseMongoUrl };
