#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Live security probe for a running NooblyJS Core deployment
 * (feature 22, part 4). Run it against staging and production after each
 * deploy:
 *
 *   npm run probe -- --url https://staging.example.com
 *   npm run probe -- --url https://staging.example.com --api-key "$ADMIN_KEY" --data-key "$KEY" --json
 *
 * `--api-key` should be an admin key (ADMIN_API_KEYS) for the keyed checks;
 * `--data-key`, a plain API key, is checked to be refused by the admin API.
 *
 * Read-only by default. `--invasive` adds checks that write (a wrong-password
 * login, an invitation request), which count towards rate limits and leave an
 * audit trail, so use it on staging.
 *
 * Exit code 0 when every check passes, 1 when any fails, 2 on bad arguments.
 */

const DEFAULT_TIMEOUT_MS = 10000;

function parseArgs(argv) {
  const args = { url: null, apiKey: process.env.PROBE_API_KEY || null, dataKey: process.env.PROBE_DATA_KEY || null, invasive: false, json: false, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--data-key') args.dataKey = argv[++i];
    else if (a === '--invasive') args.invasive = true;
    else if (a === '--json') args.json = true;
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Fetches without following redirects; never throws on HTTP errors. */
async function call(base, path, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(new URL(path, base), init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

/** Routes an anonymous caller must never reach (one or more per service). */
const PROTECTED = [
  ['GET', '/services/authservice/api/users'],
  ['GET', '/services/authservice/api/roles'],
  ['GET', '/services/authservice/api/invitations'],
  ['GET', '/services/filing/api/file-tree'],
  ['GET', '/services/filing/api/download/README.md'],
  ['GET', '/services/filing/api/settings'],
  ['POST', '/services/working/api/run'],
  ['POST', '/services/scheduling/api/tasks'],
  ['POST', '/services/workflow/api/workflows'],
  ['GET', '/services/workflow/api/state'],
  ['GET', '/services/caching/api/get/probe'],
  ['POST', '/services/caching/api/put/probe'],
  ['GET', '/services/dataservice/api/containers'],
  ['GET', '/services/queueing/api/queues'],
  ['GET', '/services/queueing/api/jobs'],
  ['GET', '/services/logging/api/logs'],
  ['GET', '/services/settings/api/groups'],
  ['POST', '/services/ai/api/prompt'],
  ['POST', '/services/ai/api/complete'],
  ['POST', '/services/fetching/api/fetch'],
  ['GET', '/services/api/monitoring/metrics'],
  ['GET', '/health/detailed']
];

function buildChecks(args) {
  const opts = { timeoutMs: args.timeoutMs };
  const base = args.url;
  const checks = [];
  const check = (group, name, fn) => checks.push({ group, name, fn });
  const keyHeaders = args.apiKey ? { 'x-api-key': args.apiKey } : null;

  // Platform
  check('platform', '/health/live answers 200', async () => (await call(base, '/health/live', opts)).status === 200);
  check('platform', '/health/ready answers 200', async () => (await call(base, '/health/ready', opts)).status === 200);
  check('platform', 'no X-Powered-By header', async () => !(await call(base, '/health', opts)).headers.get('x-powered-by'));
  check('platform', 'X-Content-Type-Options: nosniff', async () => (await call(base, '/services/', opts)).headers.get('x-content-type-options') === 'nosniff');
  check('platform', 'Content-Security-Policy is set', async () => {
    const h = (await call(base, '/services/authservice/views/login.html', { ...opts, headers: { Accept: 'text/html' } })).headers;
    return Boolean(h.get('content-security-policy') || h.get('content-security-policy-report-only'));
  });
  check('platform', 'framing is refused (X-Frame-Options or frame-ancestors)', async () => {
    const h = (await call(base, '/services/authservice/views/login.html', { ...opts, headers: { Accept: 'text/html' } })).headers;
    return Boolean(h.get('x-frame-options')) || /frame-ancestors/.test(h.get('content-security-policy') || '');
  });
  check('platform', 'Referrer-Policy: no-referrer on /services (feature 23)', async () =>
    (await call(base, '/services/authservice/api/session', opts)).headers.get('referrer-policy') === 'no-referrer');
  if (base.startsWith('https:')) {
    check('platform', 'Strict-Transport-Security is set', async () => Boolean((await call(base, '/health', opts)).headers.get('strict-transport-security')));
  }
  check('platform', 'CORS does not reflect an arbitrary origin', async () => {
    const res = await call(base, '/services/authservice/api/session', { ...opts, headers: { Origin: 'https://evil.example' } });
    return res.headers.get('access-control-allow-origin') !== 'https://evil.example' && res.headers.get('access-control-allow-origin') !== '*';
  });
  check('platform', 'unknown routes do not leak a stack trace', async () => {
    const res = await call(base, '/services/nope/api/missing', opts);
    return !/at \S+ \(|node_modules|Error:/.test(res.text);
  });

  // Authentication and authorization
  for (const [method, path] of PROTECTED) {
    check('authz', `anonymous ${method} ${path} is refused`, async () => {
      const res = await call(base, path, { ...opts, method, body: method === 'GET' ? undefined : {} });
      return res.status === 401 || res.status === 403;
    });
  }
  check('authz', 'session token in ?authToken is not accepted (feature 23)', async () =>
    [401, 403].includes((await call(base, '/services/authservice/api/users?authToken=probe-invalid', opts)).status));
  check('authz', 'API key in ?api_key is not accepted', async () =>
    [401, 403].includes((await call(base, '/services/authservice/api/users?api_key=probe-invalid', opts)).status));
  check('authz', 'an invalid Bearer token is refused', async () =>
    [401, 403].includes((await call(base, '/services/authservice/api/users', { ...opts, headers: { Authorization: 'Bearer probe-invalid' } })).status));
  check('authz', 'an invalid x-api-key is refused', async () =>
    [401, 403].includes((await call(base, '/services/authservice/api/users', { ...opts, headers: { 'x-api-key': 'probe-invalid' } })).status));
  check('authz', 'a file named "status" is not public', async () =>
    [401, 403].includes((await call(base, '/services/filing/api/download/status', opts)).status));
  check('authz', 'session endpoint reports anonymous', async () => {
    const res = await call(base, '/services/authservice/api/session', opts);
    return res.status === 200 && res.json && res.json.authenticated === false;
  });
  check('authz', 'session hand-off rejects a forged token', async () => {
    const res = await call(base, '/services/authservice/api/session/handoff', { ...opts, method: 'POST', body: { token: 'probe-invalid' } });
    return res.status === 401 || res.status === 400;
  });
  check('authz', 'cross-origin cookie POST is refused (CSRF, feature 23)', async () => {
    const res = await call(base, '/services/authservice/api/logout', { ...opts, method: 'POST', headers: { Origin: 'https://evil.example' }, body: {} });
    return res.status === 403;
  });
  check('authz', 'the admin portal redirects browsers to sign in', async () => {
    const res = await call(base, '/services/caching/', { ...opts, headers: { Accept: 'text/html' } });
    return res.status >= 300 && res.status < 400 && /login/.test(res.headers.get('location') || '');
  });

  // Checks that need a key
  if (keyHeaders) {
    check('keyed', 'the API key is accepted', async () =>
      (await call(base, '/services/queueing/api/queues', { ...opts, headers: keyHeaders })).status === 200);
    check('keyed', 'filing download rejects traversal', async () => {
      const res = await call(base, '/services/filing/api/download/..%2f..%2fpackage.json', { ...opts, headers: keyHeaders });
      return res.status === 400 || res.status === 404 || res.status === 403;
    });
    check('keyed', 'working/run rejects an absolute script path', async () => {
      const res = await call(base, '/services/working/api/run', { ...opts, method: 'POST', headers: keyHeaders, body: { scriptPath: '/etc/passwd' } });
      return res.status === 400 || res.status === 403;
    });
    check('keyed', 'fetching refuses internal addresses (SSRF)', async () => {
      const res = await call(base, '/services/fetching/api/fetch', { ...opts, method: 'POST', headers: keyHeaders, body: { url: 'http://169.254.169.254/latest/meta-data/' } });
      return res.status === 400 || res.status === 403;
    });
    check('keyed', 'filing settings cannot move the storage root', async () => {
      const res = await call(base, '/services/filing/api/settings', { ...opts, method: 'POST', headers: keyHeaders, body: { baseDir: '/' } });
      return res.status === 400 || res.status === 403;
    });
  }

  if (args.dataKey) {
    check('keyed', 'a plain API key cannot reach the admin API (M-1)', async () =>
      [401, 403].includes((await call(base, '/services/authservice/api/users', { ...opts, headers: { 'x-api-key': args.dataKey } })).status));
  }

  // Checks that write
  if (args.invasive) {
    check('invasive', 'a wrong password gets a generic 401', async () => {
      const res = await call(base, '/services/authservice/api/login', { ...opts, method: 'POST', body: { email: 'probe@example.invalid', password: 'wrong-Password-1!' } });
      return res.status === 401 && !/not found|no such user|does not exist/i.test(res.text);
    });
    check('invasive', 'an anonymous invitation request returns no code (feature 16)', async () => {
      const res = await call(base, '/services/authservice/api/invitations', { ...opts, method: 'POST', body: { email: `probe+${Date.now()}@example.invalid` } });
      const data = (res.json && (res.json.data || res.json)) || {};
      return res.status < 500 && !data.code && !data.inviteCode && !/redeem\?code=/.test(res.text);
    });
  }
  return checks;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help || !args.url) {
    console.log('Usage: npm run probe -- --url <base url> [--api-key <admin key>] [--data-key <key>] [--invasive] [--json] [--timeout <ms>]');
    process.exit(args.help ? 0 : 2);
  }

  const results = [];
  for (const c of buildChecks(args)) {
    let ok = false;
    let error = null;
    try {
      ok = await c.fn();
    } catch (err) {
      error = err.message;
    }
    results.push({ group: c.group, name: c.name, ok: ok === true, error });
    if (!args.json) console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${c.group}] ${c.name}${error ? ` (${error})` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (args.json) {
    console.log(JSON.stringify({ url: args.url, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  } else {
    console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${args.url}`);
  }
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { parseArgs, buildChecks, PROTECTED };
