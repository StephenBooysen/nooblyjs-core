# Changelog

## Unreleased

### Fixed

- **File dataservice: reads during a write.** The `file` provider rewrote a container file in place (truncate, then write) and reads take no lock, so a read during a write could see an empty or half-written file and fail with `Unexpected end of JSON input`. Writes now go to a temp file that is fsynced and renamed over the container file, as FsStore's do. A reader sees the whole old file or the whole new one.

## 2.0.0 — 2026-11-17

A major release. It removes the 1.x AI providers, enforces a strict style policy, and closes the security findings from the 2026-11-12 review.

### Breaking changes

- **Legacy AI providers removed.** The AI service factory no longer accepts `claude`, `openai`, `chatgpt`, `ollama` or `gemini`. Calling one throws an error that names its replacement. The default registry provider is now `anthropic`. The `legacy` option is gone. `openai-kv` and `tensorflow` are unchanged.
- **Strict style policy.** `style-src` has no `'unsafe-inline'`. Browsers refuse `style=""` attributes and `<style>` blocks. Any custom dashboard or page that uses them must move the styles into a stylesheet and use classes. Scripts may still set styles through `element.style`, which CSP allows.
- **`@anthropic-ai/sdk` removed** from the dependencies. `openai` stays, because `openai-kv` uses it.

### Migration

| 1.x | 2.0.0 |
|---|---|
| `aiservice('claude', { apiKey })` | `aiservice('anthropic', { apiKey })` |
| `aiservice('openai', { apiKey })` | `aiservice('openai-compatible', { baseUrl: 'https://api.openai.com/v1', apiKey })` |
| `aiservice('ollama', { endpoint })` | `aiservice('openai-compatible', { baseUrl: 'http://localhost:11434/v1' })` |
| `aiservice('gemini', { apiKey })` | `aiservice('openai-compatible', { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey })` |
| `aiservice('openai', { legacy: false })` | remove `legacy`; the shared module is the only API |

`prompt()` still works on the shared providers, so existing callers keep their code.

### Security

- **SSRF redirects.** The fetching guard validates every redirect hop, not only the requested URL. The node and axios providers no longer follow redirects unchecked, so a public URL can no longer lead to a loopback or private address.
- **Authorization.** Filing routes that the filing service restricts to admin (settings, analytics, sync, git, instances) now declare `filing:admin`. Before, they declared `filing:read` or `filing:write`, so the gate let through callers that the filing tier then refused. Admin sessions are also recognised by the filing tiers when the portal guard is off.
- **Authorization matrix.** The matrix test now checks allow-side access as well as refusals.
- **Strict CSP.** See the breaking change above.

### Added

- **Typings for the named ESM exports.** `esm/index.d.mts`, `esm/testing.d.mts`, `esm/store.d.mts`, `esm/shell.d.mts` and `esm/route-pattern.d.mts` declare each subpath. The package `exports` map points import consumers at them. `ServiceRegistry` now declares every method it exports.
- **`saveSettings({ model })`** on the shared AI service, so the dashboard's settings save works on the default provider. It is kept in memory only and resets on restart. Set `model` in the options to keep it.

### Known limits

- The model setting saved from the AI dashboard is not persisted across restarts (see above).
- Embedded NooblyJS UIs (scheduling, workflow, settings, filing) load their stylesheets from `/services/css/` and need that path to be served. Their markup needs the shared `core.css` for the classes they use.
- Two-replica horizontal scaling, live-provider checks for embeddings and knowledge answers, reliable jobs on the other queue providers, and the outbox for SimpleDB and DocumentDB remain open. See `.claude/steering/Roadmap.md`.
