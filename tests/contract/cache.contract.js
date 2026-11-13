/**
 * @fileoverview Contract every caching provider must pass (feature 11). Each
 * provider's runner calls `runCacheContract(name, makeCache, teardown)`, so the
 * memory and Redis providers are held to the same behaviour.
 */
'use strict';

/**
 * Defines the contract suite for one caching provider.
 *
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeCache Returns a cache with put, get and delete (may be async)
 * @param {Function} [teardown] Releases the cache after each test
 * @return {void}
 */
function runCacheContract(name, makeCache, teardown = async () => {}) {
  describe(`caching contract: ${name}`, () => {
    let cache;
    const unique = (label) => `contract:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    beforeEach(async () => { cache = await makeCache(); });
    afterEach(async () => { await teardown(cache); });

    it('returns a stored string, number and object unchanged', async () => {
      const k1 = unique('string');
      const k2 = unique('number');
      const k3 = unique('object');
      await cache.put(k1, 'hello');
      await cache.put(k2, 42);
      await cache.put(k3, { name: 'Ada', tags: ['a', 'b'], nested: { ok: true } });
      expect(await cache.get(k1)).toBe('hello');
      expect(await cache.get(k2)).toBe(42);
      expect(await cache.get(k3)).toEqual({ name: 'Ada', tags: ['a', 'b'], nested: { ok: true } });
    });

    it('overwrites a value on a second put', async () => {
      const k = unique('overwrite');
      await cache.put(k, 'first');
      await cache.put(k, 'second');
      expect(await cache.get(k)).toBe('second');
    });

    it('treats a missing key the same way on every provider: no value', async () => {
      const value = await cache.get(unique('missing'));
      expect(value === undefined || value === null).toBe(true);
    });

    it('removes a key on delete, and deleting a missing key does not throw', async () => {
      const k = unique('delete');
      await cache.put(k, 'x');
      await cache.delete(k);
      const after = await cache.get(k);
      expect(after === undefined || after === null).toBe(true);
      await expect(cache.delete(unique('never-set'))).resolves.not.toThrow();
    });

    it('refuses an undefined value', async () => {
      await expect(cache.put(unique('undef'), undefined)).rejects.toThrow();
    });
  });
}

module.exports = { runCacheContract };
