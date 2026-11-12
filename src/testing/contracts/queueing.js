/**
 * @fileoverview Contract every queueing provider must pass (feature 11).
 *
 * @module testing/contracts/queueing
 */

'use strict';

/**
 * @param {string} label Provider name, for the test titles
 * @param {function(): Object} factory Returns a queueing instance
 * @return {void}
 */
function queueingContract(label, factory) {
  describe(`queueing contract: ${label}`, () => {
    let queue;
    let name;
    beforeEach(async () => {
      queue = factory();
      name = `contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    });

    it('hands items out first in, first out', async () => {
      await queue.enqueue(name, { n: 1 });
      await queue.enqueue(name, { n: 2 });
      expect(await queue.dequeue(name)).toEqual({ n: 1 });
      expect(await queue.dequeue(name)).toEqual({ n: 2 });
    });

    it('reports how many items are waiting', async () => {
      expect(await queue.size(name)).toBe(0);
      await queue.enqueue(name, 'a');
      await queue.enqueue(name, 'b');
      expect(await queue.size(name)).toBe(2);
    });

    it('returns nothing from an empty queue', async () => {
      const item = await queue.dequeue(name);
      expect(item === undefined || item === null).toBe(true);
    });

    it('empties a queue on purge', async () => {
      await queue.enqueue(name, 'x');
      await queue.purge(name);
      expect(await queue.size(name)).toBe(0);
    });
  });
}

module.exports = { queueingContract };
