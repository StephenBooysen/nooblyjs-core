/**
 * @fileoverview Contract every queueing provider must pass (feature 11). Each
 * provider's runner calls `runQueueContract(name, makeQueue, teardown)`, so the
 * memory and Redis providers are held to the same behaviour.
 */
'use strict';

/**
 * Defines the contract suite for one queueing provider.
 *
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeQueue Returns a queue with enqueue, dequeue, size and purge (may be async)
 * @param {Function} [teardown] Releases the queue after each test
 * @return {void}
 */
function runQueueContract(name, makeQueue, teardown = async () => {}) {
  describe(`queueing contract: ${name}`, () => {
    let queue;
    let names = [];
    const unique = (label) => {
      const n = `contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      names.push(n);
      return n;
    };

    beforeEach(async () => { queue = await makeQueue(); names = []; });
    afterEach(async () => {
      for (const n of names) await queue.purge(n).catch(() => {});
      await teardown(queue);
    });

    it('returns items first in, first out', async () => {
      const q = unique('fifo');
      await queue.enqueue(q, 'first');
      await queue.enqueue(q, 'second');
      await queue.enqueue(q, 'third');
      expect(await queue.dequeue(q)).toBe('first');
      expect(await queue.dequeue(q)).toBe('second');
      expect(await queue.dequeue(q)).toBe('third');
    });

    it('keeps the size in step with enqueue and dequeue', async () => {
      const q = unique('size');
      expect(await queue.size(q)).toBe(0);
      await queue.enqueue(q, 1);
      await queue.enqueue(q, 2);
      expect(await queue.size(q)).toBe(2);
      await queue.dequeue(q);
      expect(await queue.size(q)).toBe(1);
    });

    it('returns undefined from dequeue on an empty queue', async () => {
      const q = unique('empty');
      expect(await queue.dequeue(q)).toBeUndefined();
    });

    it('round-trips objects with nested values', async () => {
      const q = unique('object');
      const job = { id: 7, tags: ['a', 'b'], payload: { ok: true, n: 1.5 } };
      await queue.enqueue(q, job);
      expect(await queue.dequeue(q)).toEqual(job);
    });

    it('keeps queues apart', async () => {
      const a = unique('a');
      const b = unique('b');
      await queue.enqueue(a, 'for-a');
      expect(await queue.size(b)).toBe(0);
      expect(await queue.dequeue(b)).toBeUndefined();
      expect(await queue.dequeue(a)).toBe('for-a');
    });

    it('empties a queue on purge', async () => {
      const q = unique('purge');
      await queue.enqueue(q, 'x');
      await queue.enqueue(q, 'y');
      await queue.purge(q);
      expect(await queue.size(q)).toBe(0);
    });

    it('rejects a queue name that is empty', async () => {
      await expect(queue.enqueue('', 'x')).rejects.toThrow(/invalid queue ?name/i); // memory says queueName, others say queue name
    });
  });
}

module.exports = { runQueueContract };
