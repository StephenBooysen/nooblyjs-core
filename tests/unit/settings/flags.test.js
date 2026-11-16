'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const createSettings = require('../../../src/settings');
const { bucketOf, normalizeDefinition } = require('../../../src/settings/modules/flags');
const { testDataDir } = require('../../helpers/testData');

describe('Feature flags (feature 13)', () => {
  let tempDir;
  let filepath;
  const emitters = [];
  const services = [];

  const makeEmitter = () => {
    const emitter = new EventEmitter();
    emitters.push(emitter);
    return emitter;
  };

  // Each call creates an instance over the same file, as a second process would.
  const create = (options = {}, emitter = makeEmitter()) => {
    const settings = createSettings('file', {
      filepath,
      secret: 'unit-test-secret',
      refreshMs: 0,
      ...options
    }, emitter);
    services.push(settings);
    return settings;
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(testDataDir('flags'), 'nooblyjs-flags-'));
    filepath = path.join(tempDir, 'settings.enc.json');
  });

  afterEach(async () => {
    for (const service of services.splice(0)) service.flags.destroy();
    for (const emitter of emitters.splice(0)) emitter.removeAllListeners();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('definitions', () => {
    it('accepts a valid definition and fills the defaults', () => {
      const def = normalizeDefinition('new-checkout', { enabled: true, rolloutPercent: 25 });
      expect(def).toMatchObject({ enabled: true, rolloutPercent: 25, rules: [], variants: [], defaultVariant: 'control' });
    });

    it.each([
      ['a bad name', 'bad name', {}],
      ['a non-boolean enabled', 'a', { enabled: 'yes' }],
      ['a rollout above 100', 'a', { rolloutPercent: 101 }],
      ['a negative rollout', 'a', { rolloutPercent: -1 }],
      ['an unknown rule type', 'a', { rules: [{ type: 'ip', values: ['x'] }] }],
      ['an empty rule', 'a', { rules: [{ type: 'role', values: [] }] }],
      ['duplicate variant names', 'a', { variants: [{ name: 'b', weight: 1 }, { name: 'b', weight: 1 }] }],
      ['all variant weights zero', 'a', { variants: [{ name: 'b', weight: 0 }] }],
      ['a non-object definition', 'a', 'on']
    ])('refuses %s', (_label, name, input) => {
      expect(() => normalizeDefinition(name, input)).toThrow(/^Invalid/);
    });
  });

  describe('evaluation', () => {
    it('is off for an unknown flag and for a disabled flag', async () => {
      const flags = create().flags;
      await flags.ready();
      expect((await flags.evaluate('missing')).reason).toBe('unknown');
      await flags.set('off-flag', { enabled: false, rolloutPercent: 100 });
      expect(await flags.isEnabled('off-flag', { userId: 'u1' })).toBe(false);
    });

    it('gives the same answer for the same user across restarts', async () => {
      const first = create().flags;
      await first.set('rollout', { enabled: true, rolloutPercent: 50 });
      const before = [];
      for (let i = 0; i < 200; i += 1) before.push(await first.isEnabled('rollout', { userId: `user-${i}` }));

      const restarted = create().flags;
      await restarted.ready();
      const after = [];
      for (let i = 0; i < 200; i += 1) after.push(await restarted.isEnabled('rollout', { userId: `user-${i}` }));

      expect(after).toEqual(before);
    });

    it('rolls out to roughly the configured share of users', async () => {
      const flags = create().flags;
      await flags.set('share', { enabled: true, rolloutPercent: 30 });
      let on = 0;
      const total = 5000;
      for (let i = 0; i < total; i += 1) {
        if (await flags.isEnabled('share', { userId: `person-${i}` })) on += 1;
      }
      expect(on / total).toBeGreaterThan(0.27);
      expect(on / total).toBeLessThan(0.33);
    });

    it('matches targeting rules by role, email domain and environment', async () => {
      const flags = create().flags;
      await flags.set('beta', {
        enabled: true,
        rolloutPercent: 0,
        rules: [
          { type: 'role', values: ['editor'] },
          { type: 'emailDomain', values: ['example.org'] },
          { type: 'environment', values: ['staging'] }
        ]
      });
      expect((await flags.evaluate('beta', { roles: ['editor'] })).reason).toBe('rule:role');
      expect((await flags.evaluate('beta', { email: 'Ana@Example.org' })).reason).toBe('rule:emailDomain');
      expect((await flags.evaluate('beta', { environment: 'staging' })).reason).toBe('rule:environment');
      expect(await flags.isEnabled('beta', { roles: ['user'], email: 'x@other.com', environment: 'prod' })).toBe(false);
    });

    it('splits enabled users between variants by weight, and falls back to the default variant when off', async () => {
      const flags = create().flags;
      await flags.set('pricing', {
        enabled: true,
        rolloutPercent: 100,
        variants: [{ name: 'control', weight: 50 }, { name: 'b', weight: 50 }],
        defaultVariant: 'control'
      });
      const counts = { control: 0, b: 0 };
      for (let i = 0; i < 2000; i += 1) counts[await flags.variant('pricing', { userId: `v-${i}` })] += 1;
      expect(counts.control / 2000).toBeGreaterThan(0.45);
      expect(counts.b / 2000).toBeGreaterThan(0.45);

      await flags.set('pricing', { enabled: false, variants: [{ name: 'control', weight: 1 }, { name: 'b', weight: 1 }], defaultVariant: 'b' });
      expect(await flags.variant('pricing', { userId: 'anyone' })).toBe('b');
    });

    it('reports the variant as on or off for a flag without variants', async () => {
      const flags = create().flags;
      await flags.set('plain', { enabled: true, rolloutPercent: 100 });
      expect(await flags.variant('plain', { userId: 'x' })).toBe('on');
    });

    it('emits flags:evaluated for each evaluation', async () => {
      const emitter = makeEmitter();
      const flags = create({}, emitter).flags;
      await flags.set('watched', { enabled: true, rolloutPercent: 100 });
      const spy = jest.fn();
      emitter.on('flags:evaluated', spy);
      await flags.isEnabled('watched', { userId: 'u' });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ flag: 'watched', enabled: true }));
    });

    it('records the last evaluation time for the dashboard', async () => {
      const flags = create().flags;
      await flags.set('seen', { enabled: true, rolloutPercent: 100 });
      expect((await flags.list()).find((f) => f.name === 'seen').lastEvaluatedAt).toBeNull();
      await flags.isEnabled('seen', { userId: 'u' });
      expect((await flags.list()).find((f) => f.name === 'seen').lastEvaluatedAt).not.toBeNull();
    });
  });

  describe('management', () => {
    it('stores definitions, timestamps them and deletes them', async () => {
      const emitter = makeEmitter();
      const flags = create({}, emitter).flags;
      const changed = jest.fn();
      emitter.on('flags:changed', changed);

      await flags.set('lifecycle', { enabled: true, rolloutPercent: 10, description: 'test' });
      const created = (await flags.list()).find((f) => f.name === 'lifecycle');
      expect(created.createdAt).toBeTruthy();
      expect(created.updatedAt).toBeTruthy();

      await flags.set('lifecycle', { enabled: true, rolloutPercent: 20 });
      const updated = (await flags.list()).find((f) => f.name === 'lifecycle');
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.rolloutPercent).toBe(20);

      expect(await flags.delete('lifecycle')).toBe(true);
      expect((await flags.list()).some((f) => f.name === 'lifecycle')).toBe(false);
      expect(changed.mock.calls.map((c) => c[0].action)).toEqual(['created', 'updated', 'deleted']);
    });

    it('applies a change made in this process at once, without a restart', async () => {
      const flags = create().flags;
      await flags.ready();
      expect(await flags.isEnabled('live', { userId: 'u' })).toBe(false);
      await flags.set('live', { enabled: true, rolloutPercent: 100 });
      expect(await flags.isEnabled('live', { userId: 'u' })).toBe(true);
    });

    it('picks up a change written by another process within the poll interval', async () => {
      const reader = create({ refreshMs: 50 }).flags;
      await reader.ready();
      const writer = create().flags;
      await writer.set('remote', { enabled: true, rolloutPercent: 100 });

      const deadline = Date.now() + 3000;
      let enabled = false;
      while (!enabled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        enabled = await reader.isEnabled('remote', { userId: 'u' });
      }
      expect(enabled).toBe(true);
    });

    it('skips a stored definition that fails validation, and keeps the valid ones', async () => {
      const settings = create();
      await settings.set('broken', { enabled: 'maybe' }, 'flags');
      const flags = create().flags;
      await flags.set('good', { enabled: true, rolloutPercent: 100 });
      const names = (await flags.list()).map((f) => f.name);
      expect(names).toEqual(['good']);
    });

    it('never writes the settings file just by starting up', async () => {
      const flags = create({ refreshMs: 10 }).flags;
      await flags.ready();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(fs.existsSync(filepath)).toBe(false);
      expect(await flags.isEnabled('anything', { userId: 'u' })).toBe(false);
    });

    it('stops the poll and removes listeners when destroyed', async () => {
      const emitter = makeEmitter();
      const flags = create({ refreshMs: 10 }, emitter).flags;
      flags.destroy();
      expect(emitter.listenerCount('settings:updated')).toBe(0);
      expect(emitter.listenerCount('settings:created-key')).toBe(0);
    });
  });

  describe('hashing', () => {
    it('buckets into [0, 100) deterministically', () => {
      for (let i = 0; i < 100; i += 1) {
        const value = bucketOf('flag', `id-${i}`);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(100);
        expect(bucketOf('flag', `id-${i}`)).toBe(value);
      }
    });
  });
});
