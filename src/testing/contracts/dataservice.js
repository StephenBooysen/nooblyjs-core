/**
 * @fileoverview Contract every dataservice provider must pass (feature 11).
 *
 * @module testing/contracts/dataservice
 */

'use strict';

/**
 * @param {string} label Provider name, for the test titles
 * @param {function(): Object} factory Returns a dataservice instance
 * @return {void}
 */
function dataserviceContract(label, factory) {
  describe(`dataservice contract: ${label}`, () => {
    let data;
    let container;
    beforeEach(async () => {
      data = factory();
      container = `contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await data.createContainer(container);
    });

    it('stores an object and returns it by its key', async () => {
      const key = await data.add(container, { name: 'Ann', age: 31 });
      expect(typeof key).toBe('string');
      expect(await data.getByUuid(container, key)).toEqual(expect.objectContaining({ name: 'Ann', age: 31 }));
    });

    it('returns null for a key that does not exist', async () => {
      expect(await data.getByUuid(container, 'no-such-key')).toBeNull();
    });

    it('counts the objects in a container', async () => {
      await data.add(container, { n: 1 });
      await data.add(container, { n: 2 });
      expect(await data.count(container)).toBe(2);
    });

    it('finds objects whose content matches a term', async () => {
      await data.add(container, { city: 'Cape Town' });
      await data.add(container, { city: 'Durban' });
      const found = await data.find(container, 'cape');
      expect(found.map((o) => o.city)).toEqual(['Cape Town']);
    });

    it('removes one object and reports whether it did', async () => {
      const key = await data.add(container, { gone: true });
      expect(await data.remove(container, key)).toBe(true);
      expect(await data.getByUuid(container, key)).toBeNull();
      expect(await data.remove(container, key)).toBe(false);
    });

    it('updates an object in place', async () => {
      const key = await data.add(container, { status: 'new' });
      await data.update(container, key, { status: 'done' });
      expect(await data.getByUuid(container, key)).toEqual(expect.objectContaining({ status: 'done' }));
    });
  });
}

module.exports = { dataserviceContract };
