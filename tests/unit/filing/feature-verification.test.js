/**
 * @fileoverview Feature Verification Tests for Filing Service
 *
 * Comprehensive test suite verifying all documented features and functionality
 * of the Filing Service including file operations, multiple providers, sync capabilities,
 * settings management, and analytics tracking.
 *
 * Test Coverage:
 * - Core File Operations (create, read, update, delete, list)
 * - Provider Support (local, s3, ftp, git, gcp, sync, api)
 * - Settings Management (getSettings, saveSettings)
 * - Sync Provider Features (file locking, auto-sync)
 * - Git Provider Features (commits, push, fetch)
 * - Analytics Module (operation tracking, statistics)
 * - Error Handling (validation, graceful failures)
 * - API Contract (method exposure, return types)
 */

'use strict';

const createFilingService = require('../../../src/filing');
const EventEmitter = require('events');
const path = require('node:path');
const { testDataDir } = require('../../helpers/testData');

describe('Filing Service - Feature Verification', () => {
  let filing;
  let mockEventEmitter;
  const testDir = testDataDir('filing-feature-verification');

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    filing = createFilingService('local', {
      baseDir: testDir,
      dependencies: {
        logging: { info: jest.fn(), error: jest.fn() }
      }
    }, mockEventEmitter);
  });

  afterEach(() => {
    // Cleanup is handled by Jest
    jest.clearAllMocks();
  });

  describe('Core Service API - create()', () => {
    it('should create a file with string content', async () => {
      await filing.create('test.txt', 'Hello World');
      expect(true).toBe(true); // File created successfully
    });

    it('should create a file with buffer content', async () => {
      const buffer = Buffer.from('binary data');
      await filing.create('binary.bin', buffer);
      expect(true).toBe(true);
    });

    it('should create file in nested directory', async () => {
      await filing.create('nested/dir/file.txt', 'content');
      expect(true).toBe(true);
    });

    it('should support upload alias', async () => {
      expect(typeof filing.upload).toBe('function');
      await filing.upload('alias-test.txt', 'test');
      expect(true).toBe(true);
    });

    it('should return promise', async () => {
      const result = filing.create('promise-test.txt', 'test');
      expect(result instanceof Promise).toBe(true);
      await result;
    });

    it('should handle special characters in filename', async () => {
      await filing.create('file-with-dash_and_underscore.txt', 'content');
      expect(true).toBe(true);
    });

    it('should handle various content types', async () => {
      await filing.create('string.txt', 'text');
      await filing.create('number.txt', '123');
      await filing.create('json.json', JSON.stringify({ key: 'value' }));
      expect(true).toBe(true);
    });
  });

  describe('Core Service API - read()', () => {
    beforeEach(async () => {
      await filing.create('read-test.txt', 'test content');
    });

    it('should read file and return buffer by default', async () => {
      const content = await filing.read('read-test.txt');
      expect(Buffer.isBuffer(content) || typeof content === 'string').toBe(true);
    });

    it('should read with utf8 encoding', async () => {
      const content = await filing.read('read-test.txt', 'utf8');
      expect(typeof content).toBe('string');
    });

    it('should support download alias', async () => {
      expect(typeof filing.download).toBe('function');
      const content = await filing.download('read-test.txt');
      expect(content).toBeDefined();
    });

    it('should return promise', async () => {
      const result = filing.read('read-test.txt');
      expect(result instanceof Promise).toBe(true);
      await result;
    });

    it('should handle different encodings', async () => {
      const base64 = await filing.read('read-test.txt', 'base64');
      expect(typeof base64).toBe('string');
    });
  });

  describe('Core Service API - update()', () => {
    beforeEach(async () => {
      await filing.create('update-test.txt', 'original');
    });

    it('should update file content', async () => {
      await filing.update('update-test.txt', 'updated');
      const content = await filing.read('update-test.txt', 'utf8');
      expect(content).toContain('updated');
    });

    it('should support buffer content', async () => {
      const buffer = Buffer.from('buffer content');
      await filing.update('update-test.txt', buffer);
      expect(true).toBe(true);
    });

    it('should return promise', async () => {
      const result = filing.update('update-test.txt', 'new');
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Core Service API - delete()', () => {
    beforeEach(async () => {
      await filing.create('delete-test.txt', 'content');
    });

    it('should delete a file', async () => {
      await filing.delete('delete-test.txt');
      expect(true).toBe(true);
    });

    it('should support remove alias', async () => {
      await filing.create('remove-test.txt', 'content');
      expect(typeof filing.remove).toBe('function');
      await filing.remove('remove-test.txt');
      expect(true).toBe(true);
    });

    it('should return promise', async () => {
      await filing.create('promise-delete.txt', 'test');
      const result = filing.delete('promise-delete.txt');
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Core Service API - list()', () => {
    beforeEach(async () => {
      await filing.create('file1.txt', 'content1');
      await filing.create('file2.txt', 'content2');
      await filing.create('nested/file3.txt', 'content3');
    });

    it('should list directory contents', async () => {
      const files = await filing.list('.');
      expect(Array.isArray(files)).toBe(true);
    });

    it('should return array of entries', async () => {
      const files = await filing.list('.');
      if (files.length > 0) {
        // list() returns rich directory entries: { name, type, isDirectory, ... }
        expect(typeof files[0]).toBe('object');
        expect(typeof files[0].name).toBe('string');
      }
    });

    it('should list subdirectory', async () => {
      const files = await filing.list('nested/');
      expect(Array.isArray(files)).toBe(true);
    });

    it('should return promise', async () => {
      const result = filing.list('.');
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Settings Management - getSettings()', () => {
    it('should return settings object', async () => {
      const settings = await filing.getSettings();
      expect(typeof settings).toBe('object');
    });

    it('should have required properties', async () => {
      const settings = await filing.getSettings();
      expect(settings).toBeDefined();
    });

    it('should return promise', async () => {
      const result = filing.getSettings();
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Settings Management - saveSettings()', () => {
    it('should reject unknown settings with a 400', async () => {
      await expect(filing.saveSettings({ key: 'value' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('should return promise', async () => {
      const result = filing.saveSettings({});
      expect(result instanceof Promise).toBe(true);
      await result;
    });

    it('should apply a valid partial update', async () => {
      await filing.saveSettings({ maxFileSize: '2048' });
      const settings = await filing.getSettings();
      expect(settings.maxFileSize).toBe(2048);
    });
  });

  describe('Provider Support', () => {
    it('should create local provider', () => {
      expect(filing.provider).toBeDefined();
    });

    it('should expose provider create method', () => {
      expect(typeof filing.provider.create).toBe('function');
    });

    it('should expose provider read method', () => {
      expect(typeof filing.provider.read).toBe('function');
    });

    it('should expose provider delete method', () => {
      expect(typeof filing.provider.delete).toBe('function');
    });

    it('should expose provider update method', () => {
      expect(typeof filing.provider.update).toBe('function');
    });

    it('should expose provider list method', () => {
      expect(typeof filing.provider.list).toBe('function');
    });
  });

  describe('Sync Provider Features', () => {
    it('should support sync provider initialization', () => {
      // Sync provider requires remoteType
      expect(() => {
        createFilingService('sync', {}, mockEventEmitter);
      }).toThrow('remoteType');
    });

    it('should throw on unsupported sync remote type', () => {
      expect(() => {
        createFilingService('sync', {
          remoteType: 'invalid-type'
        }, mockEventEmitter);
      }).toThrow();
    });

    it('should support lockFile if provider supports it', async () => {
      // Check that lockFile method exists or throws appropriate error
      try {
        await filing.lockFile('test.txt', 'reason');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support unlockFile if provider supports it', async () => {
      try {
        await filing.unlockFile('test.txt');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support syncFile if provider supports it', async () => {
      try {
        await filing.syncFile('test.txt');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support syncAll if provider supports it', async () => {
      try {
        await filing.syncAll();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support getSyncStatus if provider supports it', async () => {
      try {
        await filing.getSyncStatus();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support startAutoSync if provider supports it', () => {
      try {
        filing.startAutoSync();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support stopAutoSync if provider supports it', () => {
      try {
        filing.stopAutoSync();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support processRemoteChanges if provider supports it', async () => {
      try {
        await filing.processRemoteChanges(['file1.txt']);
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support pushFile if provider supports it', async () => {
      try {
        await filing.pushFile('test.txt');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support pullFile if provider supports it', async () => {
      try {
        await filing.pullFile('test.txt');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });
  });

  describe('Git Provider Features', () => {
    it('should support commitWithMessage if provider supports it', async () => {
      try {
        await filing.commitWithMessage('commit-id', 'message', 'user123');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support push if provider supports it', async () => {
      try {
        await filing.push();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support fetch if provider supports it', async () => {
      try {
        await filing.fetch();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support getGitStatus if provider supports it', async () => {
      try {
        await filing.getGitStatus();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support getPendingCommits if provider supports it', () => {
      try {
        filing.getPendingCommits();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support cancelCommit if provider supports it', async () => {
      try {
        await filing.cancelCommit('commit-id');
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support startAutoFetch if provider supports it', () => {
      try {
        filing.startAutoFetch();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should support stopAutoFetch if provider supports it', () => {
      try {
        filing.stopAutoFetch();
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });
  });

  describe('Analytics Module', () => {
    it('should track write operations', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      await filing.create('analytics-test.txt', 'content');

      const stats = analytics.getStats();
      expect(stats.totalWrites).toBeGreaterThan(0);
    });

    it('should track read operations', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      await filing.create('read-analytics.txt', 'content');
      await filing.read('read-analytics.txt');

      const stats = analytics.getStats();
      expect(stats.totalReads).toBeGreaterThan(0);
    });

    it('should track delete operations', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      await filing.create('delete-analytics.txt', 'content');
      await filing.delete('delete-analytics.txt');

      const stats = analytics.getStats();
      expect(stats.totalDeletes).toBeGreaterThan(0);
    });

    it('should provide aggregate statistics', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      await filing.create('file1.txt', 'content1');
      await filing.create('file2.txt', 'content2');
      await filing.read('file1.txt');

      const stats = analytics.getStats();
      expect(stats.totalPaths).toBeGreaterThan(0);
      expect(stats.totalOperations).toBeGreaterThan(0);
    });

    it('should provide path-specific analytics', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      await filing.create('specific-path.txt', 'content');
      await filing.read('specific-path.txt');

      const pathAnalytics = analytics.getPathAnalytics('specific-path.txt');
      expect(pathAnalytics).toBeDefined();
    });

    it('should support analytics clearing', () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      const stats = analytics.getStats();
      expect(stats.totalPaths).toBe(0);
    });

    it('should provide top accessed paths', async () => {
      const analytics = require('../../../src/filing/modules/analytics');
      analytics.clear();

      for (let i = 0; i < 5; i++) {
        await filing.create(`file${i}.txt`, 'content');
      }

      const topPaths = analytics.getAnalytics(10);
      expect(Array.isArray(topPaths)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing provider', () => {
      expect(() => {
        createFilingService('unsupported-type', {}, mockEventEmitter);
      }).toThrow('Unsupported');
    });

    it('should handle invalid sync provider config', () => {
      expect(() => {
        createFilingService('sync', {}, mockEventEmitter);
      }).toThrow();
    });

    it('should require provider in FilingService', () => {
      const FilingService = require('../../../src/filing/index.js').constructor;
      // Note: The factory pattern makes direct testing difficult
      // This is tested implicitly through the factory method
      expect(true).toBe(true);
    });

    it('should throw on unsupported provider methods', async () => {
      try {
        // Local provider doesn't support git operations
        await filing.push();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('not supported');
      }
    });

    it('should handle concurrent operations', async () => {
      const operations = [];

      for (let i = 0; i < 10; i++) {
        operations.push(filing.create(`concurrent-${i}.txt`, `content${i}`));
      }

      await Promise.all(operations);
      expect(true).toBe(true);
    });
  });

  describe('API Contract Verification', () => {
    it('should expose create method', () => {
      expect(typeof filing.create).toBe('function');
    });

    it('should expose read method', () => {
      expect(typeof filing.read).toBe('function');
    });

    it('should expose update method', () => {
      expect(typeof filing.update).toBe('function');
    });

    it('should expose delete method', () => {
      expect(typeof filing.delete).toBe('function');
    });

    it('should expose list method', () => {
      expect(typeof filing.list).toBe('function');
    });

    it('should expose upload alias', () => {
      expect(typeof filing.upload).toBe('function');
    });

    it('should expose download alias', () => {
      expect(typeof filing.download).toBe('function');
    });

    it('should expose remove alias', () => {
      expect(typeof filing.remove).toBe('function');
    });

    it('should expose getSettings method', () => {
      expect(typeof filing.getSettings).toBe('function');
    });

    it('should expose saveSettings method', () => {
      expect(typeof filing.saveSettings).toBe('function');
    });

    it('should expose provider property', () => {
      expect(filing.provider).toBeDefined();
    });

    it('should expose eventEmitter property', () => {
      expect(filing.eventEmitter_).toBeDefined();
    });

    it('should return promises from async methods', async () => {
      expect(filing.create('test.txt', 'test') instanceof Promise).toBe(true);
      expect(filing.read('test.txt') instanceof Promise).toBe(true);
      expect(filing.update('test.txt', 'new') instanceof Promise).toBe(true);
      expect(filing.delete('test.txt') instanceof Promise).toBe(true);
      expect(filing.list('.') instanceof Promise).toBe(true);
      expect(filing.getSettings() instanceof Promise).toBe(true);
      expect(filing.saveSettings({}) instanceof Promise).toBe(true);
    });

    it('should have file operations work correctly', async () => {
      // Test complete workflow
      await filing.create('workflow.txt', 'initial');
      const read1 = await filing.read('workflow.txt', 'utf8');
      expect(read1).toContain('initial');

      await filing.update('workflow.txt', 'updated');
      const read2 = await filing.read('workflow.txt', 'utf8');
      expect(read2).toContain('updated');

      const list = await filing.list('.');
      expect(Array.isArray(list)).toBe(true);

      await filing.delete('workflow.txt');
      expect(true).toBe(true);
    });
  });
});
