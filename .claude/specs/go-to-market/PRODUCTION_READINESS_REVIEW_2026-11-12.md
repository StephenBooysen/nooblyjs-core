# Production Readiness and Security Review — NooblyJS Core

**Date:** 2026-11-12
**Commit reviewed:** `74bb8a3` on `main`, plus the uncommitted working tree
**Package version:** 1.0.10
**Previous reviews:** `.claude/steering/go-to-market/PRODUCTION_READINESS_REVIEW.md` (2026-05-29), `PRODUCTION_READINESS_TEST_2026-09-29.md` (70/70 live checks)
**Reviewer:** Claude Code

## Verdict

**Not ready for internet-facing production.** The September remediation closed the earlier P0–P2 list, and the test suite is green. But this review found two critical issues and three high ones. Chained together, they let **an anonymous visitor read and write arbitrary files on the server**, and they give a path to code execution.

Each critical and high finding below was either reproduced against an isolated instance or confirmed by reading the code (marked in the table). The reproduction script and its output are in `.temp/tests/review-2026-11-12/` (`repro-invite-to-filing.js`, `repro-output.txt`). It uses temporary directories and a file auth store under `.temp/`, and touches no application data.

| | Count |
|---|---|
| Critical | 2 |
| High | 3 |
| Medium | 4 |
| Low | 3 |

## The headline chain (reproduced)

| Step | Request | Result |
|---|---|---|
| 1 | Anonymous `POST /services/authservice/api/invitations` `{name, email}` | `201`, response contains `code` with `status: "approved"` |
| 2 | Anonymous `POST /services/authservice/api/invitations/{code}/redeem` `{password}` | `201`, active account, role `user` |
| 3 | `POST /services/authservice/api/login` | `200`, session token |
| 4 | As that user, `GET /services/authservice/api/users` and `POST /services/working/api/run` | `403` (the admin guard works here) |
| 5 | As that user, `POST /services/filing/api/default/settings` `{"baseDir": "<any directory>"}` | `200 OK` |
| 6 | As that user, `GET /services/filing/api/default/download/secret.txt` | `200`, contents of a file **outside** the filing store |
| 7 | As that user, upload `evil.html`, then download it | Served `Content-Type: text/html`, `Content-Disposition: inline` on the portal origin |

In a deployment shaped like `app.js`, step 6 can read `.env`, `.application/data` (user records, sessions, settings) and the source tree, and the same setting allows writes there. Step 7 is a stored XSS: when an admin opens the link, the CSP (`script-src 'unsafe-inline'`) lets the script run with the admin session, which can call `/services/working/api/run`, and that runs any script path (H-3).

## Findings

| ID | Severity | Finding | Evidence | Feature |
|---|---|---|---|---|
| C-1 | Critical | **Any authenticated user can change the filing root and read or write any file.** `/services/filing/api/*` is deliberately exempt from the admin guard (`src/authservice/middleware/services.js`, `isPathPublic`), so only the data-plane middleware applies, and it accepts any valid session or token regardless of role. `POST /:instanceName/settings` calls `saveSettings`, which accepts `baseDir`. `_resolveAndVerifyPath` contains paths within the **live** `this.settings.baseDir`. Every user can also delete any file and run git/sync push, pull and commit. | Reproduced (steps 5–6) | 15 |
| C-2 | Critical (chain enabler) | **Registration is effectively open.** `/api/register` returns 403, but the public `POST /api/invitations` creates an auto-approved invitation (`authBase.requestInvitation`: "Auto-approved: invite codes are usable immediately") and returns the code to the requester. No rate limit, no email verification. | Reproduced (steps 1–3) | 16 |
| H-1 | High | **Stored XSS through filing.** `allowedTypes` defaults to `*`; `.html`/`.htm`/`.svg` are served inline with an active MIME type from the same origin as `/services`; the CSP allows inline scripts. | Reproduced (step 7); exploit needs an admin to open a link | 17 |
| H-2 | High | **Known-vulnerable production dependencies.** `npm audit --omit=dev`: 21 advisories, 8 high, 3 critical. These include `simple-git` (command execution through Git config; used by the git filing provider), `proxy-addr` (IP spoofing with trusted subnets, which affects `TRUST_PROXY` and per-IP login rate limiting), `@azure/msal-node`, `body-parser`, `multer`, `node-forge`. The CI audit gate fails. | `npm audit` run 2026-11-12 | 20 |
| H-3 | High | **Arbitrary script execution for any admin session or API key.** `POST /services/working/api/run` takes `scriptPath`; `resolveActivityPath_` returns absolute paths unchanged and resolves `..` without containment. The scheduling manager (`POST /api/tasks` with `scriptPath`) and workflow definitions have the same issue. With M-1, every data-plane API key is admin, so one leaked key means code execution. | Code review | 18 |
| M-1 | Medium | **Data-plane API keys grant admin portal access** when no admin keys are configured (`getConfiguredAdminApiKeys` fallback). `app.js` configures none. | Code review | 19 |
| M-2 | Medium | **Session tokens in URLs.** Both guards accept `?authToken=`; `src/views/index.html` and `src/dataservice/views/index.html` build such URLs. Tokens end up in history, proxy logs and `Referer`. | Code review | 23 |
| M-3 | Medium | **Process-local security and scheduling state.** Login lockout (`failedLogins` Map), invitations (in-memory Map, not persisted by the file provider) and cron timers live in one process. With several replicas, lockout can be bypassed by spreading attempts, invitations vanish on restart, and every replica fires every cron job (no leader election). | Code review | 21 |
| M-4 | Medium | **CSP still allows `'unsafe-inline'` scripts and script attributes.** Already a follow-up in the remediation tracker, but now the reason H-1 is exploitable. | `contentSecurityPolicy.js` | 17 |
| L-1 | Low | **Admin routes rely on one guard.** Routes documented "admin only" (users, roles, invitations approve/batch) use `requireAuthenticatedSession`, which checks validity, not role. They are safe only because the portal guard blocks non-admins, and the exemptions for filing and profile show how easily that list grows. | Code review | 19 |
| L-2 | Low | **Tests write outside `.temp/`.** The Jest run creates `.application/data/ai-tokens.json`, because `aibase.js` defaults to `process.cwd()/.application/data`. That breaks the repo's output-location rule. The file was removed after this review. | Observed during the run | 22 |
| L-3 | Low | **Library defaults.** The local filing provider still defaults `baseDir` to `./` for direct library users (known follow-up), and `allowedTypes` defaults to `*`. | Code review | 15, 17 |

## What is in good shape

- **Tests:** 108 suites pass (2,228 tests, 80 skipped by design), in 32 s.
- **Sessions:** `httpOnly`, `secure` in production, `sameSite: 'strict'`; production refuses to start without `SESSION_SECRET`; Redis session store available.
- **Credentials:** bcrypt hashing; the default admin password is random and written to a 0600 bootstrap file, never logged; API key comparison is timing-safe; login has per-IP rate limiting and per-account lockout.
- **Errors and input:** `sendSafeError`/`ClientError`, `validate()` and list caps, SSRF guard and path-traversal tests (`tests/unit/security/`).
- **New code since September:** the UI kit's `html` template escapes by default; `FsStore` validates every path segment; the AI module has no dependencies.
- **Platform:** helmet, same-origin CORS by default, body and upload size limits, health and readiness probes, graceful shutdown, Docker with a non-root user and `HEALTHCHECK`.

## Release blockers

Before an internet-facing deployment: 15, 16, 17 (at least the safe-serving part), 18, and the dependency fixes in 20. Until then, run NooblyJS only on a private network, and with `allowedTypes` restricted and invitations handled by an admin.

## Recommended immediate mitigations (no code changes)

1. Put the app behind a private network or SSO-only proxy.
2. Set filing `allowedTypes` to a safe list (no `html`, `htm`, `svg`, `xml`, `js`).
3. Block `POST /services/authservice/api/invitations` and `/services/filing/api/*/settings` at the proxy for non-admin traffic.
4. Configure separate admin API keys (`security.servicesAuth.apiKeys`) so data-plane keys don't grant the portal.
5. Run `npm audit fix` for the non-breaking advisories and redeploy.
