/**
 * @fileoverview `nooblyjs create --template` (feature 09): each template writes
 * its files, the .gitignore is written with its dot, and unknown templates are
 * refused. The generated apps' own tests run in CI (the templates job).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { testDataDir } = require('../../helpers/testData');
const { main } = require('../../../src/cli');
const { TEMPLATES, templateFiles } = require('../../../src/cli/create');

const sink = () => ({ write: () => true });

describe('nooblyjs create templates (feature 09)', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(testDataDir('cli'), 'tpl-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists the three templates', () => {
    expect(TEMPLATES).toEqual(['api', 'dashboard', 'ai']);
  });

  it.each(['api', 'dashboard', 'ai'])('writes the %s template with its tests and a dotted .gitignore', async (kind) => {
    const dir = path.join(root, `${kind}-app`);
    const code = await main(['create', dir, '--template', kind, '--yes'], { stdout: sink(), stderr: sink(), cwd: root });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'test', 'app.test.js'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toMatch(new RegExp(`# ${kind}-app`));
  });

  it('gives the AI template its docs folder and a key note in the README', () => {
    const files = templateFiles('my-ai', 'ai');
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['docs/welcome.md', 'app.js']));
    expect(files['README.md']).toMatch(/x-api-key/);
    expect(files['.env.example']).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('refuses a template that does not exist', async () => {
    const err = { write: jest.fn(() => true) };
    const code = await main(['create', path.join(root, 'x'), '--template', 'nope'], { stdout: sink(), stderr: err, cwd: root });
    expect(code).toBe(2);
    expect(err.write.mock.calls.join('')).toMatch(/does not exist/);
  });

  it('the dashboard app turns on the services login and does not expose an API key', () => {
    const app = templateFiles('d', 'dashboard')['app.js'];
    expect(app).toMatch(/requireLogin: true/);
    expect(app).not.toMatch(/apiKey:\s*'/);
  });
});
