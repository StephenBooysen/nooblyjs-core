/**
 * @fileoverview Unit tests for the encrypted settings provider.
 *
 * Covers grouped key/value CRUD, secret masking, encryption at rest,
 * persistence across instances and master secret rotation.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('events');

const createSettings = require('../../../src/settings');
const { testDataDir } = require('../../helpers/testData');

describe('Settings', () => {
  /** @type {string} Temporary directory holding the encrypted file */
  let tempDir;
  /** @type {string} Path of the encrypted settings file */
  let filepath;
  /** @type {Object} Settings service instance under test */
  let settings;
  /** @type {EventEmitter} Mock event emitter for verifying events */
  let mockEventEmitter;

  /**
   * Creates a settings service pointed at the temporary file.
   *
   * @param {Object=} overrides Provider option overrides.
   * @return {Object} A settings service instance.
   */
  /** Every instance made by create(), so afterEach can stop their flag pollers. */
  let created = [];

  const create = (overrides = {}) => {
    const service = createSettings('file', {
      filepath,
      secret: 'unit-test-secret',
      ...overrides
    }, mockEventEmitter);
    created.push(service);
    return service;
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(testDataDir('settings'), 'nooblyjs-settings-'));
    filepath = path.join(tempDir, 'settings.enc.json');
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    settings = create();
  });

  afterEach(() => {
    for (const service of created) service.flags?.destroy?.();
    created = [];
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe('values', () => {
    it('should store and read a value in a group', async () => {
      await settings.set('host', 'localhost', 'database');

      expect(await settings.get('host', 'database')).toBe('localhost');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'settings:created-key',
        expect.objectContaining({ group: 'database', key: 'host' })
      );
    });

    it('should resolve a dotted group.key reference', async () => {
      await settings.set('port', 5432, 'database');
      expect(await settings.get('database.port')).toBe(5432);
    });

    it('should default to the default group', async () => {
      await settings.set('theme', 'dark');
      expect(await settings.getGroup()).toEqual({ theme: 'dark' });
    });

    it('should preserve value types', async () => {
      await settings.set('retries', 3, 'app');
      await settings.set('enabled', true, 'app');
      await settings.set('endpoints', { primary: 'a' }, 'app');

      expect(await settings.get('app.retries')).toBe(3);
      expect(await settings.get('app.enabled')).toBe(true);
      expect(await settings.get('app.endpoints')).toEqual({ primary: 'a' });
    });

    it('should return undefined for an unknown key', async () => {
      expect(await settings.get('missing', 'database')).toBeUndefined();
    });

    it('should update an existing value', async () => {
      await settings.set('host', 'localhost', 'database');
      await settings.set('host', 'db.internal', 'database');
      expect(await settings.get('database.host')).toBe('db.internal');
    });

    it('should delete a value', async () => {
      await settings.set('host', 'localhost', 'database');

      expect(await settings.delete('host', 'database')).toBe(true);
      expect(await settings.has('database.host')).toBe(false);
      expect(await settings.delete('host', 'database')).toBe(false);
    });

    it('should reject invalid keys and values', async () => {
      await expect(settings.set('bad key!', 'x', 'app')).rejects.toThrow(/Invalid setting key/);
      await expect(settings.set('key', undefined, 'app')).rejects.toThrow(/cannot be undefined/);
      await expect(settings.set('key', 'x', 'bad/group')).rejects.toThrow(/Invalid group name/);
    });
  });

  describe('groups', () => {
    it('should create the group implicitly on first write', async () => {
      await settings.set('user', 'mailer', 'smtp');

      const groups = await settings.listGroups();
      expect(groups.map((group) => group.name)).toEqual(
        expect.arrayContaining(['default', 'smtp'])
      );
    });

    it('should list groups with key and secret counts', async () => {
      await settings.createGroup('smtp', 'Mail server');
      await settings.set('user', 'mailer', 'smtp');
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      const smtp = (await settings.listGroups()).find((g) => g.name === 'smtp');
      expect(smtp).toEqual(expect.objectContaining({
        description: 'Mail server',
        count: 2,
        secrets: 1
      }));
    });

    it('should refuse to create a duplicate group', async () => {
      await settings.createGroup('smtp');
      await expect(settings.createGroup('smtp')).rejects.toThrow(/already exists/);
    });

    it('should delete a group and its settings', async () => {
      await settings.set('user', 'mailer', 'smtp');

      expect(await settings.deleteGroup('smtp')).toBe(true);
      await expect(settings.getGroup('smtp')).rejects.toThrow(/Unknown settings group/);
    });

    it('should clear rather than remove the default group', async () => {
      await settings.set('theme', 'dark');
      await settings.deleteGroup('default');

      expect(await settings.getGroup('default')).toEqual({});
    });
  });

  describe('secrets', () => {
    it('should mask secret values by default and reveal on request', async () => {
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      expect((await settings.getGroup('smtp')).password).toBe('********');
      expect((await settings.getGroup('smtp', { reveal: true })).password).toBe('hunter2');
    });

    it('should always return the clear value from get()', async () => {
      await settings.set('password', 'hunter2', 'smtp', { secret: true });
      expect(await settings.get('smtp.password')).toBe('hunter2');
    });

    it('should keep the secret flag when the value is updated', async () => {
      await settings.set('password', 'hunter2', 'smtp', { secret: true });
      await settings.set('password', 'hunter3', 'smtp');

      const meta = await settings.getMeta('smtp.password');
      expect(meta.secret).toBe(true);
    });
  });

  describe('encryption', () => {
    it('should not write any value in clear text', async () => {
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      const raw = fs.readFileSync(filepath, 'utf8');
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('smtp');

      const envelope = JSON.parse(raw);
      expect(envelope.algorithm).toBe('aes-256-gcm');
      expect(envelope.payload).toEqual(expect.any(String));
    });

    it('should decrypt settings written by a previous instance', async () => {
      await settings.set('host', 'localhost', 'database');
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      const reopened = create();
      expect(await reopened.get('database.host')).toBe('localhost');
      expect(await reopened.get('smtp.password')).toBe('hunter2');
    });

    it('should fail to read the file with the wrong secret', async () => {
      await settings.set('host', 'localhost', 'database');

      const wrong = create({ secret: 'not-the-secret' });
      await expect(wrong.get('database.host')).rejects.toThrow(/Unable to decrypt/);
    });

    it('should detect a tampered payload', async () => {
      await settings.set('host', 'localhost', 'database');

      const envelope = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      const payload = Buffer.from(envelope.payload, 'base64');
      payload[0] ^= 0xff;
      envelope.payload = payload.toString('base64');
      fs.writeFileSync(filepath, JSON.stringify(envelope));

      const reopened = create();
      await expect(reopened.get('database.host')).rejects.toThrow(/Unable to decrypt/);
    });

    it('should re-encrypt under a new secret when rotated', async () => {
      await settings.set('host', 'localhost', 'database');
      await settings.rotateSecret('rotated-secret');

      await expect(create().get('database.host')).rejects.toThrow(/Unable to decrypt/);

      const rotated = create({ secret: 'rotated-secret' });
      expect(await rotated.get('database.host')).toBe('localhost');
    });
  });

  describe('bulk operations', () => {
    it('should return every group from getAll', async () => {
      await settings.set('host', 'localhost', 'database');
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      expect(await settings.getAll()).toEqual({
        default: {},
        database: { host: 'localhost' },
        smtp: { password: '********' }
      });
    });

    it('should import a nested group object', async () => {
      const result = await settings.import({
        database: { host: 'localhost', port: 5432 },
        smtp: { user: 'mailer' }
      });

      expect(result).toEqual({ groups: 2, keys: 3 });
      expect(await settings.get('database.port')).toBe(5432);
    });

    it('should reject an invalid import payload', async () => {
      await expect(settings.import({ database: 'nope' }))
        .rejects.toThrow(/Invalid import payload/);
    });

    it('should report statistics for the dashboard', async () => {
      await settings.set('host', 'localhost', 'database');
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      const statistics = await settings.getStatistics();
      expect(statistics).toEqual(expect.objectContaining({
        groups: 3,
        keys: 2,
        secrets: 1,
        encrypted: true,
        algorithm: 'aes-256-gcm'
      }));
      expect(statistics.fileSize).toBeGreaterThan(0);
    });
  });

  describe('provider configuration', () => {
    it('should expose the provider settings descriptor', async () => {
      const providerSettings = await settings.getSettings();

      expect(providerSettings.list.map((s) => s.setting))
        .toEqual(['filepath', 'autosave', 'maskSecrets']);
      expect(providerSettings.filepath).toBe(filepath);
    });

    it('should never expose the master secret', async () => {
      const providerSettings = await settings.getSettings();
      expect(JSON.stringify(providerSettings)).not.toContain('unit-test-secret');
    });

    it('should apply configuration changes', async () => {
      await settings.saveSettings({ maskSecrets: 'false' });
      await settings.set('password', 'hunter2', 'smtp', { secret: true });

      expect((await settings.getGroup('smtp')).password).toBe('hunter2');
    });

    it('should only write on demand when autosave is off', async () => {
      const manual = create({ autosave: false });
      await manual.set('host', 'localhost', 'database');

      expect(await create().get('database.host')).toBeUndefined();

      await manual.save();
      expect(await create().get('database.host')).toBe('localhost');
    });
  });
});
