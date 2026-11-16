'use strict';

const express = require('express');
const { EventEmitter } = require('node:events');
const serviceRegistry = require('../../index');

describe('clustered mode guard (feature 21)', () => {
  beforeEach(() => serviceRegistry.reset());
  afterEach(async () => {
    await serviceRegistry.shutdown().catch(() => {});
    serviceRegistry.reset();
  });

  it('does nothing when clustering is off, even with process-local providers', () => {
    serviceRegistry.initialize(express(), new EventEmitter(), {});
    serviceRegistry.cache('memory');
    expect(serviceRegistry.verifyClusterMode()).toEqual([]);
  });

  it('refuses process-local providers in clustered mode, and names the provider to switch to', () => {
    serviceRegistry.initialize(express(), new EventEmitter(), {
      cluster: { enabled: true }
    });
    serviceRegistry.cache('memory');
    serviceRegistry.queue('memory');
    expect(() => serviceRegistry.verifyClusterMode()).toThrow(/caching:memory \(use a Redis cache/);
    expect(() => serviceRegistry.verifyClusterMode()).toThrow(/queueing:memory \(use a Redis queue/);
  });

  it('accepts a provider listed in cluster.allowLocalProviders', () => {
    serviceRegistry.initialize(express(), new EventEmitter(), {
      cluster: { enabled: true, allowLocalProviders: ['caching:memory', 'queueing:memory'] }
    });
    serviceRegistry.cache('memory');
    serviceRegistry.queue('memory');
    expect(serviceRegistry.verifyClusterMode()).toEqual([]);
  });

  it('gives every service the shared state store, which is memory unless a Redis URL is set', () => {
    serviceRegistry.initialize(express(), new EventEmitter(), {});
    expect(serviceRegistry.stateStore.kind).toBe('memory');
  });
});
