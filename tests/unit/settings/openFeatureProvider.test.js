'use strict';

/**
 * @fileoverview OpenFeature provider over NooblyJS flags (feature 13). The
 * mapping tests always run. The SDK case runs when @openfeature/server-sdk is
 * installed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const createSettings = require('../../../src/settings');
const { createOpenFeatureProvider, toFlagContext, reasonOf } = require('../../../src/settings/modules/openFeatureProvider');
const { testDataDir } = require('../../helpers/testData');

const hasSdk = (() => {
  try { require.resolve('@openfeature/server-sdk'); return true; } catch (_error) { return false; }
})();
const describeSdk = hasSdk ? describe : describe.skip;

describe('OpenFeature provider (feature 13)', () => {
  let dir;
  let settings;
  let flags;
  let provider;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(testDataDir('openfeature'), 'nooblyjs-of-'));
    settings = createSettings('file', {
      filepath: path.join(dir, 'settings.enc.json'),
      secret: 'openfeature-test-secret',
      flagsRefreshMs: 0
    }, new EventEmitter());
    flags = settings.flags;
    await flags.set('beta-search', { enabled: true, rules: [{ type: 'role', values: ['admin'] }] });
    await flags.set('dark-mode', { enabled: true, rolloutPercent: 100 });
    await flags.set('off-flag', { enabled: false });
    await flags.set('colour', { enabled: true, rolloutPercent: 100, variants: [{ name: 'red', weight: 500 }, { name: 'blue', weight: 500 }], defaultVariant: 'red' });
    provider = createOpenFeatureProvider(flags, { name: 'test' });
  });

  afterEach(() => {
    flags.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps targetingKey, email, roles and environment to a flag context', () => {
    expect(toFlagContext({ targetingKey: 'u1', email: 'a@x.test', roles: ['admin'], environment: 'production' }))
      .toEqual({ userId: 'u1', email: 'a@x.test', roles: ['admin'], environment: 'production' });
    expect(toFlagContext({ roles: 'admin, editor' })).toEqual({ roles: ['admin', 'editor'] });
    expect(toFlagContext(undefined)).toEqual({});
  });

  it('reports a targeting match for a caller with the role', async () => {
    const res = await provider.resolveBooleanEvaluation('beta-search', false, { targetingKey: 'u1', roles: ['admin'] });
    expect(res).toEqual({ value: true, variant: 'on', reason: 'TARGETING_MATCH' });
  });

  it('reports a disabled flag as DISABLED with the default-off value', async () => {
    const res = await provider.resolveBooleanEvaluation('off-flag', true, { targetingKey: 'u1' });
    expect(res).toMatchObject({ value: false, reason: 'DISABLED' });
  });

  it('reports a rollout the caller is inside as SPLIT, and outside as DEFAULT', async () => {
    expect(await provider.resolveBooleanEvaluation('dark-mode', false, { targetingKey: 'u1' })).toMatchObject({ value: true, reason: 'SPLIT' });
    await flags.set('dark-mode', { enabled: true, rolloutPercent: 0 });
    expect(await provider.resolveBooleanEvaluation('dark-mode', false, { targetingKey: 'u1' })).toMatchObject({ value: false, reason: 'DEFAULT' });
  });

  it('returns the default with FLAG_NOT_FOUND for an unknown flag', async () => {
    const res = await provider.resolveBooleanEvaluation('nope', 'fallback-default', {});
    expect(res).toMatchObject({ value: 'fallback-default', reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' });
  });

  it('returns the variant as a string, and reports a type mismatch', async () => {
    const variant = await provider.resolveStringEvaluation('colour', 'none', { targetingKey: 'u9' });
    expect(['red', 'blue']).toContain(variant.value);
    const mismatch = await provider.resolveNumberEvaluation('colour', 7, { targetingKey: 'u9' });
    expect(mismatch).toMatchObject({ value: 7, reason: 'ERROR', errorCode: 'TYPE_MISMATCH' });
  });

  it('returns an object with enabled and variant', async () => {
    const res = await provider.resolveObjectEvaluation('beta-search', {}, { roles: ['admin'] });
    expect(res.value).toEqual({ enabled: true, variant: 'on' });
  });

  it('maps every NooblyJS reason', () => {
    expect(reasonOf({ enabled: false, reason: 'disabled' })).toBe('DISABLED');
    expect(reasonOf({ enabled: true, reason: 'rule:role' })).toBe('TARGETING_MATCH');
    expect(reasonOf({ enabled: true, reason: 'rollout' })).toBe('SPLIT');
    expect(reasonOf({ enabled: false, reason: 'rollout' })).toBe('DEFAULT');
    expect(reasonOf({ enabled: false, reason: 'off' })).toBe('DEFAULT');
  });

  it('is available from the flags object as openFeatureProvider()', async () => {
    const viaMethod = flags.openFeatureProvider({ name: 'method' });
    expect(viaMethod.metadata.name).toBe('method');
    expect(await viaMethod.resolveBooleanEvaluation('beta-search', false, { roles: ['admin'] })).toMatchObject({ value: true });
  });

  it('rejects a FeatureFlags-less argument', () => {
    expect(() => createOpenFeatureProvider(null)).toThrow(/FeatureFlags/);
  });

  describeSdk('with the OpenFeature server SDK', () => {
    it('serves flags to an OpenFeature client', async () => {
      const { OpenFeature } = require('@openfeature/server-sdk');
      await OpenFeature.setProviderAndWait(provider);
      const client = OpenFeature.getClient('test');
      expect(await client.getBooleanValue('beta-search', false, { targetingKey: 'u1', roles: ['admin'] })).toBe(true);
      expect(await client.getBooleanValue('beta-search', false, { targetingKey: 'u1', roles: ['viewer'] })).toBe(false);
      expect(await client.getBooleanValue('nope', true, {})).toBe(true);
      await OpenFeature.clearProviders();
    });
  });
});
