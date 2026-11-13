/**
 * @fileoverview Contract every filing provider must pass (feature 11). Each
 * provider's runner calls `runFilingContract(name, makeFiling, teardown)`.
 * Paths are relative to the provider's root, and the root itself is '.'. Every provider must refuse a path
 * that climbs out of its root.
 */
'use strict';

/**
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeFiling Returns a filing service with create, read, update, delete and list (may be async)
 * @param {Function} [teardown] Releases the provider after each test
 * @return {void}
 */
function runFilingContract(name, makeFiling, teardown = async () => {}) {
  describe(`filing contract: ${name}`, () => {
    let filing;
    const unique = (label) => `contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;

    beforeEach(async () => { filing = await makeFiling(); });
    afterEach(async () => { await teardown(filing); });

    it('returns the content that was created', async () => {
      const f = unique('roundtrip');
      await filing.create(f, 'hello filing');
      expect(String(await filing.read(f, 'utf8'))).toBe('hello filing');
      await filing.delete(f);
    });

    it('replaces the content on update', async () => {
      const f = unique('update');
      await filing.create(f, 'first');
      await filing.update(f, 'second');
      expect(String(await filing.read(f, 'utf8'))).toBe('second');
      await filing.delete(f);
    });

    it('lists a created file by name', async () => {
      const f = unique('listed');
      await filing.create(f, 'x');
      const entries = await filing.list('.'); // the root is '.', not '/'
      const names = (entries || []).map((e) => e.name);
      expect(names).toContain(f);
      await filing.delete(f);
    });

    it('no longer returns a file after delete', async () => {
      const f = unique('deleted');
      await filing.create(f, 'x');
      await filing.delete(f);
      await expect(filing.read(f, 'utf8')).rejects.toBeDefined();
    });

    it('rejects a read of a file that does not exist', async () => {
      await expect(filing.read(unique('missing'), 'utf8')).rejects.toBeDefined();
    });

    it('refuses a path that climbs out of its root', async () => {
      await expect(filing.read('../outside-the-root.txt', 'utf8')).rejects.toBeDefined();
      await expect(filing.create('../../outside-the-root.txt', 'x')).rejects.toBeDefined();
    });
  });
}

module.exports = { runFilingContract };
