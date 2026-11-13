/**
 * @fileoverview Tests for option validation and the typed registry surface
 * (feature 08).
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const EventEmitter = require('events');
const express = require('express');
const schemas = require('../../../src/shared/config/optionSchemas');
const { testDataDir } = require('../../helpers/testData');
const {
  validateServiceOptions,
  assertServiceOptions,
  resetOptionWarnings,
  editDistance
} = require('../../../src/shared/utils/optionSchema');

describe('option validation (feature 08)', () => {
  beforeEach(() => resetOptionWarnings());

  it('suggests the closest valid name for a typo', () => {
    const { warnings } = validateServiceOptions('caching', 'redis', { redisUrll: 'x' }, schemas);
    expect(warnings).toEqual([expect.stringContaining('did you mean "redisUrl"?')]);
  });

  it('reports a wrong type as an error', () => {
    const { errors } = validateServiceOptions('caching', 'redis', { poolSize: 'ten' }, schemas);
    expect(errors).toEqual(['caching/redis: option "poolSize" must be a number']);
  });

  it('reports missing required options', () => {
    const { errors } = validateServiceOptions('filing', 's3', { bucketName: 'b' }, schemas);
    expect(errors).toEqual(['filing/s3: missing required option "region"']);
  });

  it('maps the canonical camelCase name onto the name the provider reads', () => {
    const { options } = validateServiceOptions('caching', 'redis', { redisUrl: 'redis://h' }, schemas);
    expect(options.redisurl).toBe('redis://h');
  });

  it('warns once about a legacy spelling', () => {
    const first = validateServiceOptions('caching', 'redis', { redisurl: 'redis://h' }, schemas);
    const second = validateServiceOptions('caching', 'redis', { redisurl: 'redis://h' }, schemas);
    expect(first.warnings).toHaveLength(1);
    expect(second.warnings).toHaveLength(0);
  });

  it('does not check services or providers without a schema', () => {
    const result = validateServiceOptions('searching', 'memory', { anything: 1 }, schemas);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('covers authservice, aiservice and the other services (feature 08)', () => {
    for (const [service, provider] of [
      ['authservice', 'file'], ['authservice', 'google'], ['aiservice', 'anthropic'], ['aiservice', 'claude'],
      ['settings', 'file'], ['workflow', 'memory'], ['scheduling', 'memory'], ['working', 'default'],
      ['notifying', 'memory'], ['measuring', 'default'], ['searching', 'api']
    ]) {
      expect(schemas[service][provider]).toBeDefined();
    }
  });

  it('suggests the right name for a misspelt authservice or aiservice option', () => {
    expect(validateServiceOptions('authservice', 'file', { sessionIdleTimoutMs: {} }, schemas).warnings[0])
      .toMatch(/did you mean "sessionIdleTimeoutMs"/);
    expect(validateServiceOptions('aiservice', 'anthropic', { budget: {} }, schemas).warnings[0])
      .toMatch(/did you mean "budgets"/);
  });

  it('requires the OAuth credentials for the Google provider', () => {
    const result = validateServiceOptions('authservice', 'google', { clientID: 'id' }, schemas);
    expect(result.errors).toEqual([expect.stringContaining('clientSecret')]);
  });

  it('rejects a wrongly typed AI budget', () => {
    const result = validateServiceOptions('aiservice', 'mock', { budgets: 5 }, schemas);
    expect(result.errors).toEqual([expect.stringContaining('budgets')]);
  });

  it('throws on errors, and on warnings only in strict mode', () => {
    const onWarning = jest.fn();
    expect(() => assertServiceOptions('caching', 'redis', { redisUrll: 'x' }, schemas, { onWarning }))
      .not.toThrow();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('redisUrl'));

    expect(() => assertServiceOptions('caching', 'redis', { redisUrll: 'x' }, schemas, { strict: true }))
      .toThrow(/strictOptions/);
    expect(() => assertServiceOptions('caching', 'redis', { poolSize: 'x' }, schemas, { onWarning }))
      .toThrow(/must be a number/);
  });

  it('measures edit distance without regard to case', () => {
    expect(editDistance('RedisUrl', 'redisurl')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('registry option checks (feature 08)', () => {
  /** Loads a fresh registry so each case starts uninitialised. */
  function freshRegistry() {
    let registry;
    jest.isolateModules(() => {
      registry = require('../../../index');
    });
    return registry;
  }

  it('creates the service with a warning when strictOptions is off', () => {
    const registry = freshRegistry();
    const events = new EventEmitter();
    const warned = jest.fn();
    events.on('config:option-warning', warned);
    registry.initialize(express(), events, { security: { servicesAuth: { requireLogin: false } } });

    const filing = registry.filing('local', { baseDir: testDataDir('config-filing-warn'), maxFileSise: 5 });
    expect(filing).toBeDefined();
    expect(warned).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: 'filing',
      message: expect.stringContaining('did you mean "maxFileSize"?')
    }));
    registry.shutdown?.();
  });

  it('refuses the same typo when strictOptions is on', () => {
    const registry = freshRegistry();
    registry.initialize(express(), new EventEmitter(), {
      strictOptions: true,
      security: { servicesAuth: { requireLogin: false } }
    });
    expect(() => registry.filing('local', { baseDir: testDataDir('config-filing-strict'), maxFileSise: 5 }))
      .toThrow(/strictOptions/);
    registry.shutdown?.();
  });
});
