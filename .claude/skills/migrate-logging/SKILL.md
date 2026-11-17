---
type: Skill
name: migrate-logging
description: Replace server-side console.* calls in nooblyjs-core with the injected logging service using optional chaining and structured metadata, without changing behaviour. Use when the user asks to clean up logging or finish the console migration for a file or service.
argument-hint: "<file, folder or service>"
---

# Migrate console.* to the logging service

Scope: $ARGUMENTS (if empty, list remaining server-side `console.` calls under `src/` and ask which to tackle).

## Find

```bash
grep -rn "console\.\(log\|info\|warn\|error\|debug\)" src --include=*.js \
  | grep -v "/scripts/" | grep -v "/views/"
```

Leave browser code alone: files under `src/*/scripts/` and `src/*/views/` (and `public/`) run in the browser, where `console` is correct.

## Rewrite

- Get the logger the way the file's class already does, normally `this.logger = options.dependencies?.logging || null` in the constructor. If the file has no access to a logger (module-level helper, worker thread), add an optional `logger` parameter or leave the call and note why — don't import a logger singleton.
- Map levels: `console.log`/`info` → `this.logger?.info`, `warn` → `warn`, `error` → `error`, `debug` → `debug`.
- Message format: `` `[${this.constructor.name}] What happened` `` plus a metadata object with the context that was string-concatenated before, e.g.:

```javascript
// before
console.error('Failed to connect to ' + host + ': ' + err.message);
// after
this.logger?.error(`[${this.constructor.name}] Failed to connect`, {
  host,
  error: err.message,
  operation: 'connect'
});
```

- Never log secrets (passwords, API keys, tokens, connection strings with credentials).
- Keep control flow identical — same throws, returns and fallbacks.
- In tight loops, log periodically or summarise rather than per item.

## Verify

- Run the affected service's tests, then `npm test`.
- Re-run the grep to confirm what's left in scope, and report any calls you intentionally kept and why.
- If this completes a file listed in `CLAUDE.md`'s "migration is incomplete" note, update that note.
- Commit only if asked: `refactor({service}): route console output through logger in {file}`.
