'use strict';

/**
 * @fileoverview Validated provider options (feature 08): typo suggestions,
 * type errors, strictOptions, canonical aliases, and the JSON Schema
 * validator behind them.
 */

const express = require('express');
const { EventEmitter } = require('events');
const registry = require('../../index');
const { checkServiceOptions, resetReported } = require('../../src/shared/utils/serviceOptions');
const { validateSchema, closestKey } = require('../../src/shared/utils/jsonSchema');

const init = (globalOptions = {}) => {
  registry.reset();
  const events = new EventEmitter();
  registry.initialize(express(), events, { requireApiKey: false, security: { servicesAuth: { requireLogin: false } }, ...globalOptions });
  const warnings = [];
  events.on('service:options-warning', (w) => warnings.push(w.message));
  return warnings;
};

describe('service options', () => {
  let warnSpy;

  beforeEach(() => {
    resetReported();
    warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    for (const [key, service] of registry.services.entries()) {
      if (key.includes(':redis:')) service.client_?.disconnect?.();
    }
    registry.reset();
  });

  it('warns about a misspelt option with a suggestion', () => {
    const warnings = init();
    registry.cache('redis', { redisUrll: 'localhost' });
    expect(warnings).toEqual([expect.stringMatching(/caching\('redis'\): unknown option "redisUrll"; did you mean "redisUrl"\?/)]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('did you mean'), expect.objectContaining({ code: 'NOOBLYJS_OPTIONS' }));
  });

  it('strictOptions turns warnings into errors', () => {
    init({ strictOptions: true });
    expect(() => registry.cache('redis', { redisUrll: 'x' })).toThrow(/strictOptions.*redisUrll/);
  });

  it('throws on a wrong type, naming service, provider and key', () => {
    init();
    expect(() => registry.cache('file', { cacheDir: 5 })).toThrow(/caching\('file'\): option "cacheDir" expected string/);
    expect(() => registry.queue('memory', { jobs: 'yes' })).toThrow(/queueing\('memory'\): option "jobs" expected object/);
  });

  it('maps a canonical name onto the spelling the provider reads, and flags the legacy one', () => {
    const warnings = init();
    const cache = registry.cache('redis', { redisUrl: 'cache.internal' });
    expect(cache.settings.redisurl).toBe('cache.internal');
    expect(warnings).toEqual([]);
    registry.queue('redis', { redisurl: 'q.internal', instanceName: 'legacy' });
    expect(warnings).toEqual([expect.stringMatching(/"redisurl" is a legacy spelling; use "redisUrl"/)]);
  });

  it('warns about unknown keys on providers with a fixed option set only', () => {
    const warnings = init();
    registry.logger('memory', { colourful: true });
    expect(warnings[0]).toMatch(/logging\('memory'\): unknown option "colourful"/);
    registry.cache('redis', { enableAutoPipelining: true, instanceName: 'open' });
    expect(warnings).toHaveLength(1);
  });

  it('reports each warning once per process', () => {
    const report = jest.fn();
    const schema = { providers: { x: { properties: { size: { type: 'number' } } } } };
    checkServiceOptions('svc', 'x', { sise: 1 }, { schema, report });
    checkServiceOptions('svc', 'x', { sise: 2 }, { schema, report });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('accepts string forms of numbers and booleans (environment variables)', () => {
    init();
    expect(() => registry.queue('redis', { redisPort: '6380', instanceName: 'env' })).not.toThrow();
    expect(() => registry.queue('redis', { redisPort: 'lots', instanceName: 'env2' })).toThrow(/redisport/);
  });
});

describe('jsonSchema', () => {
  it('validates types, required, enums, ranges, patterns, items and additionalProperties', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 2 },
        age: { type: 'integer', minimum: 0 },
        kind: { enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
        code: { type: 'string', pattern: '^[A-Z]+$' }
      }
    };
    expect(validateSchema(schema, { name: 'Ada', age: 3, kind: 'a', tags: ['x'], code: 'AB' })).toEqual([]);
    const errors = validateSchema(schema, { age: 1.5, kind: 'c', tags: ['x', 1, 'z'], code: 'ab', extra: true });
    const text = errors.map((e) => `${e.path} ${e.message}`).join('\n');
    expect(text).toMatch(/missing required "name"/);
    expect(text).toMatch(/\$\.age expected integer/);
    expect(text).toMatch(/\$\.kind must be one of/);
    expect(text).toMatch(/\$\.tags\[1\] expected string/);
    expect(text).toMatch(/\$\.tags more than 2 items/);
    expect(text).toMatch(/\$\.code does not match/);
    expect(text).toMatch(/unknown property "extra"/);
  });

  it('suggests close keys only', () => {
    expect(closestKey('redisUrll', ['redisUrl', 'poolSize'])).toBe('redisUrl');
    expect(closestKey('bucket', ['bucketName'])).toBe(null);
    expect(closestKey('buckettName', ['bucketName'])).toBe('bucketName');
    expect(closestKey('zzzz', ['redisUrl'])).toBe(null);
  });
});
