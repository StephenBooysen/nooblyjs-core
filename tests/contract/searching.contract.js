/**
 * @fileoverview Contract every searching provider must pass (feature 11): add,
 * keyword search, remove, replace and the bulk calls, with indexes kept apart.
 * Searches ask for `mode: 'keyword'`; the vector provider defaults to semantic
 * ranking, and providers without modes ignore the option.
 */
'use strict';

/**
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeSearch Returns a searching provider (may be async)
 * @param {Function} [teardown] Releases it after each test
 * @return {void}
 */
function runSearchingContract(name, makeSearch, teardown = async () => {}) {
  describe(`searching contract: ${name}`, () => {
    let search;
    const index = (label) => `contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const find = (term, containerName) => search.search(term, { containerName, mode: 'keyword' });
    const keys = (hits) => hits.map((h) => h.key ?? h.id).sort();

    beforeEach(async () => { search = await makeSearch(); });
    afterEach(async () => { await teardown(search); });

    it('finds an added document by a word in it, straight away', async () => {
      const ix = index('add');
      expect(await search.add('k1', { title: 'Rotate the settings secret', body: 'Use SETTINGS_SECRET' }, ix)).toBe(true);
      await search.add('k2', { title: 'Queues retry jobs', body: 'with backoff' }, ix);
      const hits = await find('secret', ix);
      expect(keys(hits)).toEqual(['k1']);
      expect(hits[0]).toEqual(expect.objectContaining({ id: 'k1', key: 'k1', score: expect.any(Number) }));
      expect(hits[0].obj).toEqual(expect.objectContaining({ title: 'Rotate the settings secret' }));
    });

    it('refuses a second document with the same key', async () => {
      const ix = index('dup');
      await search.add('k1', { title: 'first' }, ix);
      expect(await search.add('k1', { title: 'second' }, ix)).toBe(false);
      expect(keys(await find('first', ix))).toEqual(['k1']);
    });

    it('returns nothing for a word no document has, and refuses an empty query', async () => {
      const ix = index('none');
      await search.add('k1', { title: 'alpha' }, ix);
      expect(await find('zebra', ix)).toEqual([]);
      await expect(search.search('', ix)).rejects.toThrow();
    });

    it('removes a document and reports whether it was there', async () => {
      const ix = index('remove');
      await search.add('k1', { title: 'secret' }, ix);
      expect(await search.remove('k1', ix)).toBe(true);
      expect(await find('secret', ix)).toEqual([]);
      expect(await search.remove('k1', ix)).toBe(false);
    });

    it('replaces a document by its id, or adds it', async () => {
      const ix = index('replace');
      await search.replace({ id: 'k1', title: 'old words' }, ix);
      await search.replace({ id: 'k1', title: 'new words' }, ix);
      expect(await find('old', ix)).toEqual([]);
      expect(keys(await find('new', ix))).toEqual(['k1']);
    });

    it('adds and removes many documents, counting what it skipped or missed', async () => {
      const ix = index('bulk');
      expect(await search.addAll([{ id: 'a1', title: 'alpha' }, { id: 'a2', title: 'alpha beta' }, { title: 'no id' }], ix))
        .toEqual({ added: 2, skipped: 1 });
      expect(keys(await find('alpha', ix))).toEqual(['a1', 'a2']);
      expect(await search.removeAll(['a1', 'a2', 'a3'], ix)).toEqual({ removed: 2, missing: 1 });
      expect(await find('alpha', ix)).toEqual([]);
    });

    it('keeps indexes apart', async () => {
      const a = index('a');
      const b = index('b');
      await search.add('k1', { title: 'secret' }, a);
      expect(await find('secret', b)).toEqual([]);
    });
  });
}

module.exports = { runSearchingContract };
