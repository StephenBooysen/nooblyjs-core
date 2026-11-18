/**
 * @fileoverview Feature Verification Tests for Queueing Service
 * Comprehensive test suite verifying all documented features of the Queueing Service.
 * Tests cover core API methods, analytics, multiple instances, and error handling.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @date 2025-11-22
 */

'use strict';

const EventEmitter = require('events');
const createQueueing = require('../../../src/queueing');

describe('Queueing Service - Feature Verification', () => {
  let queue;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    queue = createQueueing('memory', {
      instanceName: 'default'
    }, mockEventEmitter);
  });

  afterEach(() => {
    mockEventEmitter.emit.mockClear();
  });

  // ============================================================================
  // CORE SERVICE API METHODS - ENQUEUE
  // ============================================================================

  describe('Core Service API Methods - enqueue()', () => {
    it('should enqueue a simple task', async () => {
      const task = { id: 1, action: 'test' };
      await queue.enqueue('tasks', task);

      const size = await queue.size('tasks');
      expect(size).toBe(1);
    });

    it('should enqueue multiple tasks in order', async () => {
      const tasks = [
        { id: 1, action: 'first' },
        { id: 2, action: 'second' },
        { id: 3, action: 'third' }
      ];

      for (const task of tasks) {
        await queue.enqueue('tasks', task);
      }

      const size = await queue.size('tasks');
      expect(size).toBe(3);
    });

    it('should emit enqueue event with instance name', async () => {
      const task = { data: 'test' };
      await queue.enqueue('tasks', task);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'queue:enqueue:default',
        expect.objectContaining({
          queueName: 'tasks',
          item: task
        })
      );
    });

    it('should throw error for empty queueName', async () => {
      await expect(queue.enqueue('', { data: 'test' }))
        .rejects
        .toThrow('Invalid queueName');
    });

    it('should throw error for undefined item', async () => {
      await expect(queue.enqueue('tasks', undefined))
        .rejects
        .toThrow('Invalid item');
    });

    it('should accept various data types', async () => {
      await queue.enqueue('tasks', 'string-task');
      await queue.enqueue('tasks', 123);
      await queue.enqueue('tasks', { obj: 'task' });
      await queue.enqueue('tasks', [1, 2, 3]);
      await queue.enqueue('tasks', true);

      const size = await queue.size('tasks');
      expect(size).toBe(5);
    });

    it('should support special characters in queueName', async () => {
      const specialNames = ['task-queue', 'task_queue', 'task.queue', 'task123'];

      for (const name of specialNames) {
        await queue.enqueue(name, { test: true });
      }

      const queueList = await queue.listQueues();
      specialNames.forEach(name => {
        expect(queueList).toContain(name);
      });
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - DEQUEUE
  // ============================================================================

  describe('Core Service API Methods - dequeue()', () => {
    it('should dequeue tasks in FIFO order', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.enqueue('tasks', { id: 3 });

      const first = await queue.dequeue('tasks');
      const second = await queue.dequeue('tasks');
      const third = await queue.dequeue('tasks');

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
      expect(third.id).toBe(3);
    });

    it('should return undefined when queue is empty', async () => {
      const result = await queue.dequeue('empty-queue');
      expect(result).toBeUndefined();
    });

    it('should emit dequeue event when item exists', async () => {
      const task = { id: 1 };
      await queue.enqueue('tasks', task);
      await queue.dequeue('tasks');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'queue:dequeue:default',
        expect.objectContaining({
          queueName: 'tasks',
          item: task
        })
      );
    });

    it('should not emit dequeue event when queue is empty', async () => {
      await queue.dequeue('empty-queue');

      const dequeueEmits = mockEventEmitter.emit.mock.calls
        .filter(call => call[0].includes('dequeue'));

      expect(dequeueEmits.length).toBe(0);
    });

    it('should throw error for invalid queueName', async () => {
      await expect(queue.dequeue(''))
        .rejects
        .toThrow('Invalid queueName');
    });

    it('should reduce queue size after dequeue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });

      const sizeBefore = await queue.size('tasks');
      await queue.dequeue('tasks');
      const sizeAfter = await queue.size('tasks');

      expect(sizeBefore).toBe(2);
      expect(sizeAfter).toBe(1);
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - SIZE
  // ============================================================================

  describe('Core Service API Methods - size()', () => {
    it('should return 0 for empty queue', async () => {
      const size = await queue.size('empty-queue');
      expect(size).toBe(0);
    });

    it('should return correct size after enqueue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });

      const size = await queue.size('tasks');
      expect(size).toBe(2);
    });

    it('should return correct size after dequeue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.enqueue('tasks', { id: 3 });

      await queue.dequeue('tasks');
      const size = await queue.size('tasks');

      expect(size).toBe(2);
    });

    it('should throw error for invalid queueName', async () => {
      await expect(queue.size(''))
        .rejects
        .toThrow('Invalid queueName');
    });

    it('should track multiple queue sizes independently', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue1', { id: 2 });
      await queue.enqueue('queue2', { id: 1 });

      const size1 = await queue.size('queue1');
      const size2 = await queue.size('queue2');

      expect(size1).toBe(2);
      expect(size2).toBe(1);
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - LIST & PURGE
  // ============================================================================

  describe('Core Service API Methods - listQueues()', () => {
    it('should return empty array for new instance', async () => {
      const freshQueue = createQueueing('memory', {
        instanceName: 'fresh'
      }, new EventEmitter());

      const queues = await freshQueue.listQueues();
      expect(queues).toEqual([]);
    });

    it('should return all queue names', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue2', { id: 1 });
      await queue.enqueue('queue3', { id: 1 });

      const queues = await queue.listQueues();
      expect(queues).toContain('queue1');
      expect(queues).toContain('queue2');
      expect(queues).toContain('queue3');
      expect(queues.length).toBe(3);
    });

    it('should still list queues after purging (but size is 0)', async () => {
      await queue.enqueue('temp', { id: 1 });
      await queue.purge('temp');

      const queues = await queue.listQueues();
      // Queue still exists in the list even after purge
      expect(queues).toContain('temp');

      // But size should be 0
      const size = await queue.size('temp');
      expect(size).toBe(0);
    });
  });

  describe('Core Service API Methods - purge()', () => {
    it('should remove all items from queue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.enqueue('tasks', { id: 3 });

      await queue.purge('tasks');
      const size = await queue.size('tasks');

      expect(size).toBe(0);
    });

    it('should emit purge event', async () => {
      await queue.enqueue('tasks', { id: 1 });
      mockEventEmitter.emit.mockClear();

      await queue.purge('tasks');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'queue:purge:default',
        { queueName: 'tasks' }
      );
    });

    it('should handle purging empty queue', async () => {
      await expect(queue.purge('empty-queue'))
        .resolves
        .toBeUndefined();
    });

    it('should throw error for invalid queueName', async () => {
      await expect(queue.purge(''))
        .rejects
        .toThrow('Invalid queueName');
    });

    it('should not affect other queues', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue2', { id: 1 });

      await queue.purge('queue1');

      const size1 = await queue.size('queue1');
      const size2 = await queue.size('queue2');

      expect(size1).toBe(0);
      expect(size2).toBe(1);
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - SETTINGS
  // ============================================================================

  describe('Core Service API Methods - Settings', () => {
    it('should get settings', async () => {
      const settings = await queue.getSettings();
      expect(settings).toBeDefined();
      expect(typeof settings).toBe('object');
    });

    it('should save settings', async () => {
      const newSettings = { test: 'value' };
      await expect(queue.saveSettings(newSettings))
        .resolves
        .toBeUndefined();
    });
  });

  // ============================================================================
  // ANALYTICS MODULE - EVENT LISTENING
  // ============================================================================

  describe('Analytics Module - Event Listening', () => {
    it('should track enqueue events', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].enqueueCount).toBe(2);
    });

    it('should track dequeue events', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.dequeue('tasks');

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].dequeueCount).toBe(1);
    });

    it('should track purge events', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.purge('tasks');

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].purgeCount).toBe(1);
    });

    it('should track activity timeline', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.dequeue('tasks');

      const timeline = queue.analytics.getTimeline();
      expect(timeline).toBeDefined();
      expect(timeline.labels).toBeDefined();
      expect(timeline.datasets).toBeDefined();
    });
  });

  // ============================================================================
  // ANALYTICS MODULE - STATISTICS
  // ============================================================================

  describe('Analytics Module - getStats()', () => {
    it('should return stats object with queue data', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue2', { id: 1 });

      const stats = queue.analytics.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalQueues).toBe(2);
      expect(stats.queues).toBeDefined();
    });

    it('should calculate correct counts per queue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.dequeue('tasks');

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].enqueueCount).toBe(2);
      expect(stats.queues['tasks'].dequeueCount).toBe(1);
      expect(stats.queues['tasks'].totalMessages).toBe(2);
    });

    it('should include timestamps', async () => {
      await queue.enqueue('tasks', { id: 1 });

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].firstActivity).toBeDefined();
      expect(stats.queues['tasks'].lastActivity).toBeDefined();
    });

    it('should track purge count separately', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.purge('tasks');

      const stats = queue.analytics.getStats();
      expect(stats.queues['tasks'].purgeCount).toBe(1);
    });
  });

  // ============================================================================
  // ANALYTICS MODULE - DISTRIBUTION & TOP QUEUES
  // ============================================================================

  describe('Analytics Module - getDistribution()', () => {
    it('should return distribution for pie chart', async () => {
      await queue.enqueue('email', { id: 1 });
      await queue.enqueue('email', { id: 2 });
      await queue.enqueue('sms', { id: 1 });

      const dist = queue.analytics.getDistribution();
      expect(dist.labels).toBeDefined();
      expect(dist.data).toBeDefined();
      expect(dist.labels.length).toBe(dist.data.length);
    });

    it('should include all queues with messages', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue2', { id: 1 });
      await queue.enqueue('queue3', { id: 1 });

      const dist = queue.analytics.getDistribution();
      expect(dist.labels).toContain('queue1');
      expect(dist.labels).toContain('queue2');
      expect(dist.labels).toContain('queue3');
    });
  });

  describe('Analytics Module - getTopQueues()', () => {
    it('should return top queues by activity', async () => {
      await queue.enqueue('busy', { id: 1 });
      await queue.enqueue('busy', { id: 2 });
      await queue.enqueue('busy', { id: 3 });
      await queue.enqueue('quiet', { id: 1 });

      const topQueues = queue.analytics.getTopQueues(5);
      expect(topQueues[0].name).toBe('busy');
      expect(topQueues[0].totalActivity).toBe(3);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await queue.enqueue(`queue${i}`, { id: 1 });
      }

      const topQueues = queue.analytics.getTopQueues(3);
      expect(topQueues.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for no queues', async () => {
      const topQueues = queue.analytics.getTopQueues(10);
      expect(topQueues).toEqual([]);
    });
  });

  describe('Analytics Module - getQueueStats()', () => {
    it('should return stats for specific queue', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.dequeue('tasks');

      const stats = queue.analytics.getQueueStats('tasks');
      expect(stats).toBeDefined();
      expect(stats.enqueueCount).toBe(2);
      expect(stats.dequeueCount).toBe(1);
    });

    it('should return null for non-existent queue', async () => {
      const stats = queue.analytics.getQueueStats('nonexistent');
      expect(stats).toBeNull();
    });
  });

  describe('Analytics Module - getQueueList()', () => {
    it('should return list with current sizes', async () => {
      await queue.enqueue('tasks', { id: 1 });
      await queue.enqueue('tasks', { id: 2 });
      await queue.enqueue('other', { id: 1 });

      const list = await queue.analytics.getQueueList(queue);
      expect(list).toBeDefined();
      expect(Array.isArray(list)).toBe(true);

      const tasksList = list.find(q => q.name === 'tasks');
      expect(tasksList.currentSize).toBe(2);
      expect(tasksList.totalEnqueued).toBe(2);
    });

    it('should work without queue service', async () => {
      await queue.enqueue('tasks', { id: 1 });

      const list = await queue.analytics.getQueueList(null);
      expect(Array.isArray(list)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await queue.enqueue(`queue${i}`, { id: 1 });
      }

      const list = await queue.analytics.getQueueList(queue, 3);
      expect(list.length).toBeLessThanOrEqual(3);
    });
  });

  // ============================================================================
  // ANALYTICS MODULE - MANAGEMENT
  // ============================================================================

  describe('Analytics Module - Management Methods', () => {
    it('should get queue count', async () => {
      await queue.enqueue('queue1', { id: 1 });
      await queue.enqueue('queue2', { id: 1 });
      await queue.enqueue('queue3', { id: 1 });

      const count = queue.analytics.getQueueCount();
      expect(count).toBe(3);
    });

    it('should clear analytics', async () => {
      await queue.enqueue('tasks', { id: 1 });
      queue.analytics.clear();

      const stats = queue.analytics.getStats();
      expect(stats.totalQueues).toBe(0);
    });

    it('should reset count after clear', async () => {
      await queue.enqueue('tasks', { id: 1 });
      queue.analytics.clear();

      const count = queue.analytics.getQueueCount();
      expect(count).toBe(0);
    });
  });

  // ============================================================================
  // MULTIPLE INSTANCES
  // ============================================================================

  describe('Multiple Instances', () => {
    it('should support different named instances', async () => {
      const queue1 = createQueueing('memory', {
        instanceName: 'queue1'
      }, new EventEmitter());

      const queue2 = createQueueing('memory', {
        instanceName: 'queue2'
      }, new EventEmitter());

      await queue1.enqueue('tasks', { instance: 1 });
      await queue2.enqueue('tasks', { instance: 2 });

      const item1 = await queue1.dequeue('tasks');
      const item2 = await queue2.dequeue('tasks');

      expect(item1.instance).toBe(1);
      expect(item2.instance).toBe(2);
    });

    it('should track analytics per instance', async () => {
      const queue1 = createQueueing('memory', {
        instanceName: 'instance1'
      }, new EventEmitter());

      const queue2 = createQueueing('memory', {
        instanceName: 'instance2'
      }, new EventEmitter());

      await queue1.enqueue('tasks', { id: 1 });
      await queue1.enqueue('tasks', { id: 2 });
      await queue2.enqueue('tasks', { id: 1 });

      const stats1 = queue1.analytics.getStats();
      const stats2 = queue2.analytics.getStats();

      expect(stats1.totalQueues).toBe(1);
      expect(stats2.totalQueues).toBe(1);
    });

    it('should emit instance-specific events', async () => {
      const emitter1 = new EventEmitter();
      jest.spyOn(emitter1, 'emit');

      const queue1 = createQueueing('memory', {
        instanceName: 'special'
      }, emitter1);

      await queue1.enqueue('tasks', { id: 1 });

      expect(emitter1.emit).toHaveBeenCalledWith(
        'queue:enqueue:special',
        expect.anything()
      );
    });
  });

  // ============================================================================
  // INTEGRATION PATTERNS
  // ============================================================================

  describe('Integration Patterns', () => {
    it('should support producer-consumer pattern', async () => {
      const tasks = [
        { id: 1, action: 'process' },
        { id: 2, action: 'validate' },
        { id: 3, action: 'complete' }
      ];

      // Producer
      for (const task of tasks) {
        await queue.enqueue('workflow', task);
      }

      // Consumer
      const consumed = [];
      const size = await queue.size('workflow');

      for (let i = 0; i < size; i++) {
        const item = await queue.dequeue('workflow');
        if (item) consumed.push(item);
      }

      expect(consumed.length).toBe(3);
      expect(consumed[0].id).toBe(1);
      expect(consumed[1].id).toBe(2);
      expect(consumed[2].id).toBe(3);
    });

    it('should accurately track statistics across operations', async () => {
      // Enqueue 5 items
      for (let i = 0; i < 5; i++) {
        await queue.enqueue('mixed', { id: i });
      }

      // Dequeue 2 items
      await queue.dequeue('mixed');
      await queue.dequeue('mixed');

      // Enqueue 3 more
      for (let i = 5; i < 8; i++) {
        await queue.enqueue('mixed', { id: i });
      }

      const stats = queue.analytics.getStats();
      expect(stats.queues['mixed'].enqueueCount).toBe(8);
      expect(stats.queues['mixed'].dequeueCount).toBe(2);
      expect(stats.queues['mixed'].totalMessages).toBe(8);

      const currentSize = await queue.size('mixed');
      expect(currentSize).toBe(6);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle operations without eventEmitter', async () => {
      const queueNoEmitter = createQueueing('memory', {
        instanceName: 'no-emitter'
      }, null);

      await expect(queueNoEmitter.enqueue('tasks', { id: 1 }))
        .resolves
        .toBeUndefined();

      const size = await queueNoEmitter.size('tasks');
      expect(size).toBe(1);
    });

    it('should handle very long queueName', async () => {
      const longName = 'q'.repeat(1000);
      await queue.enqueue(longName, { test: true });

      const size = await queue.size(longName);
      expect(size).toBe(1);
    });

    it('should handle deeply nested objects', async () => {
      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: { data: 'deep' }
              }
            }
          }
        }
      };

      await queue.enqueue('tasks', deepObject);
      const item = await queue.dequeue('tasks');

      expect(item.level1.level2.level3.level4.level5.data).toBe('deep');
    });

    it('should handle special characters in data', async () => {
      const specialData = {
        text: "Line1\nLine2\tTabbed",
        chars: "!@#$%^&*()_+-=[]{}|;:',.<>?/",
        unicode: "你好世界 🚀 مرحبا"
      };

      await queue.enqueue('tasks', specialData);
      const item = await queue.dequeue('tasks');

      expect(item.text).toBe(specialData.text);
      expect(item.chars).toBe(specialData.chars);
      expect(item.unicode).toBe(specialData.unicode);
    });
  });

  // ============================================================================
  // PERFORMANCE & EDGE CASES
  // ============================================================================

  describe('Performance & Edge Cases', () => {
    it('should handle large batch operations', async () => {
      const batchSize = 1000;

      // Enqueue large batch
      for (let i = 0; i < batchSize; i++) {
        await queue.enqueue('large-batch', {
          id: i,
          data: 'x'.repeat(100)
        });
      }

      const size = await queue.size('large-batch');
      expect(size).toBe(batchSize);

      // Dequeue all
      let count = 0;
      for (let i = 0; i < batchSize; i++) {
        const item = await queue.dequeue('large-batch');
        if (item) count++;
      }

      expect(count).toBe(batchSize);
    });

    it('should handle repeated enqueue/dequeue cycles', async () => {
      const cycles = 100;

      for (let i = 0; i < cycles; i++) {
        await queue.enqueue('cycling', { cycle: i });
        const item = await queue.dequeue('cycling');
        expect(item.cycle).toBe(i);
      }

      const finalSize = await queue.size('cycling');
      expect(finalSize).toBe(0);
    });

    it('should handle concurrent operations safely', async () => {
      const tasks = [];

      for (let i = 0; i < 100; i++) {
        tasks.push(queue.enqueue('concurrent', { id: i }));
      }

      await Promise.all(tasks);

      const size = await queue.size('concurrent');
      expect(size).toBe(100);
    });

    it('should handle whitespace-only queueName correctly', async () => {
      // Whitespace-only should be treated as empty
      await expect(queue.enqueue('   ', { data: 'test' }))
        .rejects
        .toThrow();
    });

    it('should handle null values in metadata', async () => {
      const data = {
        field1: null,
        field2: 'value',
        field3: undefined
      };

      await queue.enqueue('tasks', data);
      const item = await queue.dequeue('tasks');

      expect(item.field1).toBeNull();
      expect(item.field2).toBe('value');
    });
  });
});
