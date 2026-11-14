'use strict';

/**
 * Runs the filing contract against the git provider, with a bare repository
 * under .temp/tests/data/ as its remote (always on in npm test when the git
 * command is available; skipped otherwise). Auto-fetch is off, so nothing runs
 * on a timer.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { runFilingContract } = require('./filing.contract');
const { testDataDir } = require('../helpers/testData');
const createFiling = require('../../src/filing');

const hasGit = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch (_err) { return false; }
})();
const describeGit = hasGit ? describe : describe.skip;

/** A bare remote with one commit on main, so a clone has a branch to track. */
function bareRemote(base) {
  const remote = path.join(base, 'remote.git');
  const seed = path.join(base, 'seed');
  const git = (...args) => execFileSync('git', args, { stdio: 'ignore' });
  git('init', '--bare', '-b', 'main', remote);
  git('init', '-b', 'main', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), 'contract remote');
  git('-C', seed, '-c', 'user.email=contract@nooblyjs.local', '-c', 'user.name=Contract', 'add', '.');
  git('-C', seed, '-c', 'user.email=contract@nooblyjs.local', '-c', 'user.name=Contract', 'commit', '-m', 'seed');
  git('-C', seed, 'push', remote, 'main');
  return remote;
}

describeGit('git filing provider', () => {
  let base;
  runFilingContract(
    'git',
    async () => {
      base = fs.mkdtempSync(path.join(testDataDir('contract'), 'filing-git-'));
      const filing = createFiling('git', {
        repoUrl: bareRemote(base),
        localPath: path.join(base, 'work'),
        branch: 'main',
        autoFetch: false,
        dependencies: {}
      }, new EventEmitter());
      await (filing.provider || filing).initialize?.();
      return filing;
    },
    async (filing) => {
      await (filing?.provider || filing)?.cleanup?.();
      fs.rmSync(base, { recursive: true, force: true });
    }
  );
});
