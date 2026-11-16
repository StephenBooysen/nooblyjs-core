'use strict';

const Redis = require('ioredis');
const { MemoryStateStore, RedisStateStore, createStateStore, keyPart } = require('../../../src/shared/utils/stateStore');

/**
 * The same contract for every implementation: values round-trip, claims are
 * exclusive, counters are atomic and expire.
 */
function contract(name, makeStore, teardown = async () => {}) {
  describe(`state store contract: ${name}`, () => {
    let store;

    beforeEach(async () => {
      store = await makeStore();
    });

    afterEach(async () => {
      await teardown(store);
    });

    it('round-trips JSON values and reports absent keys as null', async () => {
      await store.set('a', { n: 1, list: [1, 2] });
      expect(await store.get('a')).toEqual({ n: 1, list: [1, 2] });
      expect(await store.get('missing')).toBeNull();
    });

    it('lets exactly one caller claim a free key', async () => {
      const results = await Promise.all([1, 2, 3, 4].map((owner) => store.setIfAbsent('claim', owner, 5000)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('counts atomically, and counts concurrent increments exactly', async () => {
      const counts = await Promise.all(Array.from({ length: 20 }, () => store.incr('counter', 60000)));
      expect(Math.max(...counts)).toBe(20);
      expect(new Set(counts).size).toBe(20);
    });

    it('expires keys after their time to live', async () => {
      await store.set('short', 'x', 50);
      await store.setIfAbsent('claimed', 'x', 50);
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(await store.get('short')).toBeNull();
      expect(await store.setIfAbsent('claimed', 'y', 5000)).toBe(true);
    });

    it('starts a counter window on the first increment only', async () => {
      await store.incr('window', 80);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await store.incr('window', 80);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await store.incr('window', 80)).toBe(1);
    });

    it('deletes keys', async () => {
      await store.set('gone', 1);
      expect(await store.del('gone')).toBe(true);
      expect(await store.get('gone')).toBeNull();
    });

    it('keeps a named index of unique members, empty when unused', async () => {
      const name = `idx-${Math.random().toString(36).slice(2)}`;
      expect(await store.indexMembers(name)).toEqual([]);
      await store.addToIndex(name, 'a');
      await store.addToIndex(name, 'b');
      await store.addToIndex(name, 'a');
      expect((await store.indexMembers(name)).sort()).toEqual(['a', 'b']);
    });
  });
}

contract('memory', async () => new MemoryStateStore(), async (store) => store.close());

const redisUrl = process.env.REDIS_URL;
const runRedis = process.env.RUN_REDIS_TESTS === '1' && Boolean(redisUrl);
const describeRedis = runRedis ? describe : describe.skip;

describeRedis('redis state store', () => {
  const clients = [];
  const prefix = `nooblyjs:test:${Date.now()}:`;

  const makeStore = () => {
    const client = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
    clients.push(client);
    return new RedisStateStore(client, { prefix });
  };

  afterAll(async () => {
    for (const client of clients) await client.quit().catch(() => {});
  });

  contract('redis', async () => makeStore(), async (store) => {
    const keys = await store.client_.keys(`${prefix}*`);
    if (keys.length) await store.client_.del(...keys);
  });

  it('shares state between two stores on different connections (two replicas)', async () => {
    const replicaA = makeStore();
    const replicaB = makeStore();
    await replicaA.set('shared', { from: 'A' });
    expect(await replicaB.get('shared')).toEqual({ from: 'A' });
    await replicaA.del('shared');
  });
});

describe('createStateStore', () => {
  it('defaults to memory when no cluster is configured', () => {
    expect(createStateStore({}).kind).toBe('memory');
    expect(createStateStore().kind).toBe('memory');
  });

  it('uses the Redis implementation when a client is supplied', () => {
    const fake = { get: jest.fn(), set: jest.fn(), eval: jest.fn(), del: jest.fn(), quit: jest.fn() };
    expect(createStateStore({ redisClient: fake }).kind).toBe('redis');
  });

  it('keeps email addresses out of key names', () => {
    expect(keyPart('Ana@Example.com')).toBe(keyPart('ana@example.com'));
    expect(keyPart('ana@example.com')).not.toContain('@');
    expect(keyPart('ana@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});
