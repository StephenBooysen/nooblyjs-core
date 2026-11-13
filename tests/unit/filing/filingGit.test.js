/**
 * @fileoverview Unit tests for the GitFilingProvider
 * Tests auto-commit, auto-pull, conflict resolution, and settings management
 */

'use strict';

const path = require('path');
const { EventEmitter } = require('events');

// Mock CommitQueue before importing the provider
jest.mock('../../../src/filing/sync/CommitQueue', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(),
    addPendingCommit: jest.fn().mockResolvedValue('commit-123'),
    completePendingCommit: jest.fn().mockResolvedValue({
      files: ['test.txt'],
      metadata: {}
    }),
    cancelPendingCommit: jest.fn().mockResolvedValue(),
    getAllPendingCommits: jest.fn().mockReturnValue([]),
    getPendingCommitsByUser: jest.fn().mockReturnValue([]),
    getPendingCommit: jest.fn().mockReturnValue(null)
  }));
});

// Mock simple-git before importing the provider
const mockGit = {
  add: jest.fn().mockResolvedValue(),
  commit: jest.fn().mockResolvedValue({ commit: 'abc123def456' }),
  push: jest.fn().mockResolvedValue(),
  pull: jest.fn().mockResolvedValue(),
  fetch: jest.fn().mockResolvedValue(),
  status: jest.fn().mockResolvedValue({
    files: [],
    staged: [],
    created: [],
    modified: [],
    deleted: [],
    behind: 0
  }),
  reset: jest.fn().mockResolvedValue(),
  merge: jest.fn().mockResolvedValue(),
  rm: jest.fn().mockResolvedValue(),
  addConfig: jest.fn().mockResolvedValue(),
  checkout: jest.fn().mockResolvedValue(),
  checkoutBranch: jest.fn().mockResolvedValue(),
  clone: jest.fn().mockResolvedValue(),
  log: jest.fn().mockResolvedValue({ all: [{ hash: 'abc123' }] })
};

jest.mock('simple-git', () => {
  return { simpleGit: jest.fn().mockImplementation(() => mockGit) };
});

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    writeFile: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockResolvedValue(Buffer.from('test')),
    readdir: jest.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
    unlink: jest.fn().mockResolvedValue()
  }
}));

const GitFilingProvider = require('../../../src/filing/providers/filingGit');

describe('GitFilingProvider', () => {
  let provider;
  let eventEmitter;
  let options;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    eventEmitter = new EventEmitter();
    options = {
      repoUrl: 'https://github.com/nooblyjs/nooblyjs-knowledge-content.git',
      localPath: '/tmp/test-repo',
      branch: 'main',
      userId: 'test-user',
      userEmail: 'test@example.com',
      userName: 'Test User',
      auth: {
        username: 'testuser',
        token: 'test-token-123'
      },
      autoFetch: true,
      fetchInterval: 30000,
      autoCommit: true,
      commitInterval: 300000,
      commitMessage: 'Auto-sync: test commit',
      conflictThreshold: 100
    };
  });

  afterEach(() => {
    if (provider) {
      if (provider._commitTimer) clearInterval(provider._commitTimer);
      if (provider._fetchTimer) clearInterval(provider._fetchTimer);
    }
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    it('should create a GitFilingProvider instance with required options', () => {
      provider = new GitFilingProvider(options, eventEmitter);
      expect(provider).toBeDefined();
      expect(provider.repoUrl).toBe(options.repoUrl);
      expect(provider.branch).toBe(options.branch);
    });

    it('should throw error if repoUrl is missing', () => {
      delete options.repoUrl;
      expect(() => {
        new GitFilingProvider(options, eventEmitter);
      }).toThrow('repoUrl');
    });

    it('should set default values for optional parameters', () => {
      const minimalOptions = {
        repoUrl: 'https://github.com/test/repo.git'
      };
      provider = new GitFilingProvider(minimalOptions, eventEmitter);
      expect(provider.branch).toBe('main');
      expect(provider.userId).toBe('default-user');
      expect(provider.autoFetch).toBe(true);
      expect(provider.autoCommit).toBe(false);
      expect(provider.conflictThreshold).toBe(100);
    });

    it('should initialize settings with proper metadata', () => {
      provider = new GitFilingProvider(options, eventEmitter);
      expect(provider.settings.description).toContain('Git Provider');
      expect(provider.settings.list).toHaveLength(7);
      expect(provider.settings.list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ setting: 'autoCommit', type: 'boolean' }),
          expect.objectContaining({ setting: 'commitInterval', type: 'number' }),
          expect.objectContaining({ setting: 'commitMessage', type: 'string' }),
          expect.objectContaining({ setting: 'conflictThreshold', type: 'number' })
        ])
      );
    });
  });

  describe('Initialization', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
    });

    it('should initialize the provider and emit git:initialized event', async () => {
      const initSpy = jest.spyOn(eventEmitter, 'emit');
      await provider.initialize();

      expect(initSpy).toHaveBeenCalledWith(
        'git:initialized',
        expect.objectContaining({
          repoUrl: options.repoUrl,
          branch: options.branch
        })
      );
      expect(provider._initialized).toBe(true);
    });

    it('should start auto-fetch if enabled', async () => {
      provider.autoFetch = true;
      const startFetchSpy = jest.spyOn(provider, 'startAutoFetch');

      await provider.initialize();

      expect(startFetchSpy).toHaveBeenCalled();
      expect(provider._fetchTimer).toBeDefined();
    });

    it('should start auto-commit if enabled', async () => {
      provider.autoCommit = true;
      const startCommitSpy = jest.spyOn(provider, 'startAutoCommit');

      await provider.initialize();

      expect(startCommitSpy).toHaveBeenCalled();
      expect(provider._commitTimer).toBeDefined();
    });

    it('should not start auto-fetch if disabled', async () => {
      provider.autoFetch = false;
      const startFetchSpy = jest.spyOn(provider, 'startAutoFetch');

      await provider.initialize();

      expect(startFetchSpy).not.toHaveBeenCalled();
      expect(provider._fetchTimer).toBeNull();
    });

    it('should not start auto-commit if disabled', async () => {
      provider.autoCommit = false;
      const startCommitSpy = jest.spyOn(provider, 'startAutoCommit');

      await provider.initialize();

      expect(startCommitSpy).not.toHaveBeenCalled();
      expect(provider._commitTimer).toBeNull();
    });
  });

  describe('Auto-Commit Functionality', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
      provider._initialized = true;
      provider.git = mockGit;
      // Reset mocks for each test
      mockGit.add.mockClear().mockResolvedValue();
      mockGit.commit.mockClear().mockResolvedValue({ commit: 'abc123def456' });
      mockGit.push.mockClear().mockResolvedValue();
      mockGit.status.mockClear().mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });
    });

    it('should stage all changes with git add -A', async () => {
      mockGit.status.mockResolvedValue({
        files: ['file1.txt'],
        staged: ['file1.txt'],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      await provider.autoCommitAndPush();

      expect(mockGit.add).toHaveBeenCalledWith(['-A']);
    });

    it('should commit with configured message and timestamp', async () => {
      mockGit.status.mockResolvedValue({
        files: [],
        staged: ['file1.txt'],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      await provider.autoCommitAndPush();

      expect(mockGit.commit).toHaveBeenCalled();
      const commitCall = mockGit.commit.mock.calls[0][0];
      expect(commitCall).toContain('Auto-sync: test commit');
      expect(commitCall).toMatch(/\[\d{4}-\d{2}-\d{2}/); // ISO timestamp
    });

    it('should push to remote after commit', async () => {
      mockGit.status.mockResolvedValue({
        files: [],
        staged: ['file1.txt'],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      await provider.autoCommitAndPush();

      expect(mockGit.push).toHaveBeenCalledWith('origin', options.branch);
    });

    it('should skip silently if nothing is staged', async () => {
      mockGit.status.mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      await provider.autoCommitAndPush();

      expect(mockGit.commit).not.toHaveBeenCalled();
      expect(mockGit.push).not.toHaveBeenCalled();
    });

    it('should emit git:auto-committed event on success', async () => {
      mockGit.status.mockResolvedValue({
        files: [],
        staged: ['file1.txt'],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await provider.autoCommitAndPush();

      expect(emitSpy).toHaveBeenCalledWith(
        'git:auto-committed',
        expect.objectContaining({
          branch: options.branch
        })
      );
    });

    it('should emit git:auto-commit-error event on failure', async () => {
      // Set up error condition in isolation
      const testError = new Error('Commit failed');
      const errorProvider = new GitFilingProvider(options, eventEmitter);
      errorProvider._initialized = true;
      errorProvider.git = { ...mockGit };
      errorProvider.git.add = jest.fn().mockRejectedValue(testError);
      errorProvider.git.status = jest.fn().mockResolvedValue({
        files: [],
        staged: ['file.txt'],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await errorProvider.autoCommitAndPush();

      expect(emitSpy).toHaveBeenCalledWith(
        'git:auto-commit-error',
        expect.objectContaining({
          error: 'Commit failed'
        })
      );
    });
  });

  describe('Auto-Commit Timer Management', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
    });

    it('should start auto-commit timer with correct interval', async () => {
      const autoCommitSpy = jest.spyOn(provider, 'autoCommitAndPush').mockResolvedValue();

      provider.startAutoCommit();

      expect(provider._commitTimer).toBeDefined();

      jest.advanceTimersByTime(options.commitInterval);
      expect(autoCommitSpy).toHaveBeenCalled();
    });

    it('should not start timer if already running', () => {
      provider._commitTimer = { _id: 123 }; // Simulated existing timer
      const originalTimer = provider._commitTimer;

      provider.startAutoCommit();

      expect(provider._commitTimer).toBe(originalTimer);
    });

    it('should emit git:auto-commit-started event', () => {
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      provider.startAutoCommit();

      expect(emitSpy).toHaveBeenCalledWith(
        'git:auto-commit-started',
        expect.objectContaining({
          interval: options.commitInterval,
          message: options.commitMessage
        })
      );
    });

    it('should stop auto-commit timer', () => {
      provider.startAutoCommit();
      const timerRef = provider._commitTimer;
      expect(timerRef).toBeDefined();

      provider.stopAutoCommit();

      expect(provider._commitTimer).toBeNull();
    });

    it('should emit git:auto-commit-stopped event', () => {
      provider.startAutoCommit();
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      provider.stopAutoCommit();

      expect(emitSpy).toHaveBeenCalledWith('git:auto-commit-stopped');
    });

    it('should silently ignore stop if timer not running', () => {
      provider._commitTimer = null;
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      provider.stopAutoCommit();

      expect(emitSpy).not.toHaveBeenCalledWith('git:auto-commit-stopped');
    });
  });

  describe('Conflict Resolution Strategy', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
      provider._initialized = true;
      provider.git = mockGit;
      // Reset mocks for each test
      mockGit.pull.mockClear().mockResolvedValue();
      mockGit.reset.mockClear().mockResolvedValue();
      mockGit.merge.mockClear().mockResolvedValue();
      mockGit.status.mockClear().mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });
    });

    it('should use local-wins strategy when changed files < threshold', async () => {
      provider.conflictThreshold = 100;
      mockGit.status.mockResolvedValue({
        files: Array(50).fill({}).map((_, i) => ({ name: `file${i}.txt` })),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 1
      });

      await provider._pullWithConflictResolution();

      expect(mockGit.pull).toHaveBeenCalledWith(['--strategy-option=ours']);
      expect(mockGit.reset).not.toHaveBeenCalled();
    });

    it('should use remote-wins strategy when changed files >= threshold', async () => {
      provider.conflictThreshold = 100;
      mockGit.status.mockResolvedValue({
        files: Array(150).fill({}).map((_, i) => ({ name: `file${i}.txt` })),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 1
      });

      await provider._pullWithConflictResolution();

      expect(mockGit.pull).not.toHaveBeenCalled();
      expect(mockGit.reset).toHaveBeenCalledWith(['--hard', `origin/${options.branch}`]);
    });

    it('should emit git:pulled with local-wins strategy details', async () => {
      provider.conflictThreshold = 100;
      mockGit.status.mockResolvedValue({
        files: Array(50).fill({}),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 1
      });

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await provider._pullWithConflictResolution();

      expect(emitSpy).toHaveBeenCalledWith(
        'git:pulled',
        expect.objectContaining({
          strategy: 'local-wins',
          changedCount: 50,
          threshold: 100
        })
      );
    });

    it('should emit git:pulled with remote-wins strategy details', async () => {
      provider.conflictThreshold = 100;
      mockGit.status.mockResolvedValue({
        files: Array(150).fill({}),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 1
      });

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await provider._pullWithConflictResolution();

      expect(emitSpy).toHaveBeenCalledWith(
        'git:pulled',
        expect.objectContaining({
          strategy: 'remote-wins',
          changedCount: 150
        })
      );
    });

    it('should handle merge failures with fallback reset', async () => {
      // Set up merge failure in isolation
      const mergeError = new Error('Merge conflict');
      const errorProvider = new GitFilingProvider(options, eventEmitter);
      errorProvider._initialized = true;
      errorProvider.git = { ...mockGit };
      errorProvider.git.pull = jest.fn().mockRejectedValue(mergeError);
      errorProvider.git.status = jest.fn().mockResolvedValue({
        files: Array(50).fill({}),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 1
      });
      errorProvider.git.merge = jest.fn().mockResolvedValue();
      errorProvider.git.reset = jest.fn().mockResolvedValue();

      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      await errorProvider._pullWithConflictResolution();

      expect(errorProvider.git.merge).toHaveBeenCalledWith(['--abort']);
      expect(errorProvider.git.reset).toHaveBeenCalledWith(['--hard', `origin/${options.branch}`]);
      expect(emitSpy).toHaveBeenCalledWith(
        'git:conflict-fallback',
        expect.objectContaining({
          error: 'Merge conflict'
        })
      );
    });
  });

  describe('Local Changed File Count', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
      provider._initialized = true;
      provider.git = mockGit;
    });

    it('should count modified files', async () => {
      mockGit.status.mockResolvedValue({
        files: Array(5).fill({}),
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      const count = await provider._getLocalChangedCount();
      expect(count).toBe(5);
    });

    it('should return 0 for clean working tree', async () => {
      mockGit.status.mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        modified: [],
        deleted: [],
        behind: 0
      });

      const count = await provider._getLocalChangedCount();
      expect(count).toBe(0);
    });
  });

  describe('Settings Management', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
    });

    it('should return current settings', async () => {
      const settings = await provider.getSettings();

      expect(settings).toBeDefined();
      expect(settings.description).toContain('Git Provider');
      expect(settings.autoCommit).toBe(true);
      expect(settings.commitInterval).toBe(300000);
      expect(settings.conflictThreshold).toBe(100);
    });

    it('should save updated settings', async () => {
      const newSettings = {
        commitInterval: 600000,
        autoCommit: false,
        conflictThreshold: 50
      };

      await provider.saveSettings(newSettings);

      expect(provider.settings.commitInterval).toBe(600000);
      expect(provider.settings.autoCommit).toBe(false);
      expect(provider.settings.conflictThreshold).toBe(50);
    });

    it('should not modify unspecified settings', async () => {
      const originalFetchInterval = provider.settings.fetchInterval;
      const newSettings = { commitInterval: 500000 };

      await provider.saveSettings(newSettings);

      expect(provider.settings.fetchInterval).toBe(originalFetchInterval);
    });

    it('should include all required settings in the list', () => {
      const settingNames = provider.settings.list.map(s => s.setting);

      expect(settingNames).toContain('autoCommit');
      expect(settingNames).toContain('commitInterval');
      expect(settingNames).toContain('commitMessage');
      expect(settingNames).toContain('conflictThreshold');
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      provider = new GitFilingProvider(options, eventEmitter);
      await provider.initialize();
    });

    it('should stop auto-fetch on cleanup', async () => {
      const stopFetchSpy = jest.spyOn(provider, 'stopAutoFetch');

      await provider.cleanup();

      expect(stopFetchSpy).toHaveBeenCalled();
      expect(provider._fetchTimer).toBeNull();
    });

    it('should stop auto-commit on cleanup', async () => {
      const stopCommitSpy = jest.spyOn(provider, 'stopAutoCommit');

      await provider.cleanup();

      expect(stopCommitSpy).toHaveBeenCalled();
      expect(provider._commitTimer).toBeNull();
    });

    it('should mark as uninitialized after cleanup', async () => {
      await provider.cleanup();

      expect(provider._initialized).toBe(false);
    });
  });

  describe('File Operations', () => {
    beforeEach(() => {
      provider = new GitFilingProvider(options, eventEmitter);
      provider._initialized = true;
      provider.git = mockGit;
      // Reset mocks for each test
      mockGit.add.mockClear();
      mockGit.rm.mockClear();
      mockGit.commit.mockClear();
    });

    it('should create a file and add to commit queue', async () => {
      const filePath = 'test.txt';
      const content = 'test content';

      await provider.create(filePath, content);

      expect(mockGit.add).toHaveBeenCalledWith(filePath);
    });

    it('should read a file', async () => {
      const filePath = 'test.txt';

      await provider.read(filePath, 'utf8');

      // File reading is handled by fs module, should not fail
      expect(mockGit.read).toBeUndefined();
    });

    it('should update a file and add to commit queue', async () => {
      const filePath = 'test.txt';
      const content = 'updated content';

      await provider.update(filePath, content);

      expect(mockGit.add).toHaveBeenCalledWith(filePath);
    });

    it('should delete a file and remove from git', async () => {
      const filePath = 'test.txt';

      await provider.delete(filePath);

      expect(mockGit.rm).toHaveBeenCalledWith(filePath);
    });
  });
});
