/**
 * @fileoverview Contract every dataservice provider must pass (feature 11): add,
 * read, update, remove, find, count, listAll and the path/criteria queries, with
 * containers kept apart. Runners call `runDataserviceContract(name, make, teardown)`
 * with the service wrapper from `src/dataservice`.
 */
'use strict';

/**
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeService Returns a dataservice (the factory's wrapper; may be async)
 * @param {Function} [teardown] Releases it after each test
 * @return {void}
 */
function runDataserviceContract(name, makeService, teardown = async () => {}) {
  describe(`dataservice contract: ${name}`, () => {
    let ds;
    const container = (label) => `contract_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    beforeEach(async () => { ds = await makeService(); });
    afterEach(async () => { await teardown(ds); });

    it('adds an object, returns a string id, and reads it back unchanged', async () => {
      const c = container('add');
      const obj = { name: 'Ada', tags: ['x', 'y'], n: 1, address: { city: 'Cape Town' } };
      const id = await ds.add(c, obj);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(await ds.getByUuid(c, id)).toEqual(expect.objectContaining(obj));
    });

    it('gives each object its own id', async () => {
      const c = container('ids');
      const a = await ds.add(c, { n: 1 });
      const b = await ds.add(c, { n: 2 });
      expect(a).not.toBe(b);
      expect(await ds.count(c)).toBe(2);
    });

    it('returns a copy: changing what was read does not change what is stored', async () => {
      const c = container('copy');
      const id = await ds.add(c, { name: 'Ada', tags: ['x'] });
      const read = await ds.getByUuid(c, id);
      read.name = 'changed';
      read.tags.push('changed');
      expect(await ds.getByUuid(c, id)).toEqual(expect.objectContaining({ name: 'Ada', tags: ['x'] }));
    });

    it('returns null for an unknown id or container', async () => {
      const c = container('missing');
      await ds.add(c, { n: 1 });
      expect(await ds.getByUuid(c, 'no-such-id')).toBeNull();
      expect(await ds.getByUuid(container('nothing'), 'no-such-id')).toBeNull();
    });

    it('replaces an object on update and reports whether it existed', async () => {
      const c = container('update');
      const id = await ds.add(c, { name: 'Ada', n: 1 });
      expect(await ds.update(c, id, { name: 'Ada L', n: 2 })).toBe(true);
      const after = await ds.getByUuid(c, id);
      expect(after).toEqual(expect.objectContaining({ name: 'Ada L', n: 2 }));
      expect(await ds.update(c, 'no-such-id', { n: 3 })).toBe(false);
    });

    it('removes an object and reports whether it existed', async () => {
      const c = container('remove');
      const id = await ds.add(c, { n: 1 });
      expect(await ds.remove(c, id)).toBe(true);
      expect(await ds.getByUuid(c, id)).toBeNull();
      expect(await ds.remove(c, id)).toBe(false);
      expect(await ds.count(c)).toBe(0);
    });

    it('finds objects by text, ignoring case, and lists all with an empty term', async () => {
      const c = container('find');
      await ds.add(c, { name: 'Ada Lovelace' });
      await ds.add(c, { name: 'Grace Hopper' });
      const hits = await ds.find(c, 'lovelace');
      expect(hits).toHaveLength(1);
      expect(hits[0]).toEqual(expect.objectContaining({ name: 'Ada Lovelace' }));
      expect(await ds.find(c, '')).toHaveLength(2);
      expect(await ds.find(c, 'nobody')).toEqual([]);
    });

    it('counts and lists a container, and an unknown container is empty', async () => {
      const c = container('count');
      await ds.add(c, { n: 1 });
      await ds.add(c, { n: 2 });
      expect(await ds.count(c)).toBe(2);
      expect(await ds.listAll(c)).toHaveLength(2);
      expect(await ds.count(container('empty'))).toBe(0);
    });

    it('queries by dotted path and by several criteria', async () => {
      const c = container('query');
      await ds.add(c, { name: 'Ada', address: { city: 'Cape Town' }, active: true });
      await ds.add(c, { name: 'Grace', address: { city: 'New York' }, active: true });
      await ds.add(c, { name: 'Alan', address: { city: 'Cape Town' }, active: false });
      const inCapeTown = await ds.jsonFindByPath(c, 'address.city', 'Cape Town');
      expect(inCapeTown.map((o) => o.name).sort()).toEqual(['Ada', 'Alan']);
      const both = await ds.jsonFindByCriteria(c, { 'address.city': 'Cape Town', active: true });
      expect(both.map((o) => o.name)).toEqual(['Ada']);
    });

    it('keeps containers apart', async () => {
      const a = container('a');
      const b = container('b');
      const id = await ds.add(a, { n: 1 });
      expect(await ds.getByUuid(b, id)).toBeNull();
      expect(await ds.count(b)).toBe(0);
    });
  });
}

module.exports = { runDataserviceContract };
