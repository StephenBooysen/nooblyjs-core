# Where generated docs and tests go

- Markdown documents written while building features (feature notes, change summaries, design write-ups, reports) go in `.temp/updates/`.
- Ad-hoc tests and their results (one-off test scripts, manual verification runs, captured output) go in `.temp/tests/`.
- Don't leave new `.md` files in the repo root or service folders, or scratch test files in `tests/`.

Exceptions:
- Product documents go in `.claude/steering/`: steering docs (architecture, requirements, usage guides), feature requirements (`product/`, `features/`) and go-to-market material such as production-readiness reviews and tests (`go-to-market/`).
- Edits to existing project docs (`README.md`, `CLAUDE.md`) stay in place.
- Permanent Jest tests that belong in the suite still go under `tests/` (e.g. `tests/unit/{service}/`), and permanent Playwright UI specs go in `tests/ui/`. Ask if it's unclear whether a test is permanent or ad-hoc.
- Playwright run output (results, traces, screenshots, HTML report) is configured to land in `.temp/tests/playwright/`.

## Temporary data from test runs and apps

All temporary data goes under `.temp/`, never the repo root (`.logs/`, `.test/`, `.test-files/`), `tests/` or the system temp dir:
- **Test-run data** (temp directories, fixture data, file-provider storage) → `.temp/tests/data/`. In Jest, use the shared helper:

  ```javascript
  const { testDataDir } = require('../../helpers/testData');
  const dir = testDataDir('auth');                                         // .temp/tests/data/auth
  const tmp = fs.mkdtempSync(path.join(testDataDir(), 'nooblyjs-upload-')); // unique temp dir
  // ...remove temp dirs in afterEach/afterAll
  ```
- **Logs** → `.temp/logs/` (the file logger's default `logDir`).
- **Ad-hoc test scripts and results** → `.temp/tests/`; Playwright output → `.temp/tests/playwright/`.

`.temp/` is git-ignored, so nothing there is committed. The standalone demo apps in `tests/app/` keep their own sample data and are not covered by this rule.
