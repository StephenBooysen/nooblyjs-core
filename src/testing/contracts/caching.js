/**
 * @fileoverview Contract every caching provider must pass (feature 11).
 *
 *   const { cachingContract } = require('nooblyjs-core/src/testing/contracts/caching');
 *   cachingContract('redis', () => serviceRegistry.cache('redis', { redisurl: url }));
 *
 * Call it at the top level of a Jest test file. Each test uses its own key
 * prefix, so providers that share storage do not interfere.
 *
 * @module testing/contracts/caching
 */

'use strict';

/**
 * @param {string} label Provider name, for the test titles
 * @param {function(): Object} factory Returns a caching instance
 * @return {void}
 */
function cachingContract(label, factory) {
  describe(`caching contract: ${label}`, () => {
    let cache;
    let seq = 0;
    /** A key no other test uses. */
    const key = (name) => `contract:${label}:${Date.now()}:${seq++}:${name}`;

    beforeEach(() => {
      cache = factory();
    });

    it('returns the value it was given', async () => {
      const k = key('string');
      await cache.put(k, 'hello');
      expect(await cache.get(k)).toBe('hello');
    });

    it('keeps structured values intact', async () => {
      const k = key('object');
      const value = { name: 'Ann', tags: ['a', 'b'], count: 3, nested: { ok: true } };
      await cache.put(k, value);
      expect(await cache.get(k)).toEqual(value);
    });

    it('keeps numbers and booleans as their own types', async () => {
      const n = key('number');
      const b = key('boolean');
      await cache.put(n, 42);
      await cache.put(b, false);
      expect(await cache.get(n)).toBe(42);
      expect(await cache.get(b)).toBe(false);
    });

    it('reports a missing key as absent (undefined or null), never as a value', async () => {
      const value = await cache.get(key('missing'));
      expect(value === undefined || value === null).toBe(true);
    });

    it('replaces the value when a key is written again', async () => {
      const k = key('overwrite');
      await cache.put(k, 'first');
      await cache.put(k, 'second');
      expect(await cache.get(k)).toBe('second');
    });

    it('keeps keys independent of each other', async () => {
      const a = key('a');
      const b = key('b');
      await cache.put(a, 1);
      await cache.put(b, 2);
      expect(await cache.get(a)).toBe(1);
      expect(await cache.get(b)).toBe(2);
    });

    it('removes a key on delete, and then it reads as absent', async () => {
      const k = key('delete');
      await cache.put(k, 'gone soon');
      await cache.delete(k);
      const value = await cache.get(k);
      expect(value === undefined || value === null).toBe(true);
    });

    it('does not store an empty key, whether it throws or ignores the write', async () => {
      try {
        await cache.put('', 'x');
      } catch (error) {
        // Refusing the write is fine.
      }
      let stored;
      try {
        stored = await cache.get('');
      } catch (error) {
        return; // Refusing an empty key on read is fine too.
      }
      expect(stored === undefined || stored === null).toBe(true);
    });
  });
}

module.exports = { cachingContract };
