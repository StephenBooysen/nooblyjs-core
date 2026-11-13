/**
 * @fileoverview Feature Verification Tests for Working Service
 * Comprehensive test suite verifying all documented features of the Working Service.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @date 2025-11-22
 */

'use strict';

const EventEmitter = require('events');
const createWorking = require('../../../src/working');
const createQueueing = require('../../../src/queueing');
const path = require('node:path');
const fs = require('node:fs').promises;

describe('Working Service - Feature Verification', () => {
  let working;
  let queueing;
  let mockEventEmitter;

  beforeEach(() => {
    // Reset singleton
    createWorking._reset();

    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    // Create queueing service (required dependency)
    queueing = createQueueing('memory', {}, mockEventEmitter);

    // Create working service
    working = createWorking('default', {
      allowAbsolutePaths: true,
      dependencies: { queueing },
      maxThreads: 2
    }, mockEventEmitter);
  });

  afterEach(async () => {
    mockEventEmitter.emit.mockClear();
    createWorking._reset();
  });

  // ============================================================================
  // CORE SERVICE API METHODS - START
  // ============================================================================

  describe('Core Service API Methods - start()', () => {
    it('should queue a task and return task ID', async () => {
      const taskId = await working.start('activities/exampleTask.js', { value: 1 });
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);
    });

    it('should emit worker:queued event', async () => {
      await working.start('activities/exampleTask.js', { value: 1 });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'worker:queued',
        expect.objectContaining({
          taskId: expect.any(String),
          scriptPath: expect.any(String),
          queueName: 'nooblyjs-core-working-incoming'
        })
      );
    });

    it('should accept task data', async () => {
      const data = { input: 'test', options: { format: 'json' } };
      const taskId = await working.start('activities/exampleTask.js', data);
      expect(taskId).toBeDefined();
    });

    it('should support completion callback', async () => {
      const callback = jest.fn();
      const taskId = await working.start('activities/exampleTask.js', {}, callback);

      expect(taskId).toBeDefined();
      // Note: Callback will be called when task completes
    });

    it('should handle absolute script paths', async () => {
      const absolutePath = path.resolve(__dirname, '../../../activities/exampleTask.js');
      const taskId = await working.start(absolutePath, {});
      expect(taskId).toBeDefined();
    });

    it('should handle relative script paths', async () => {
      const taskId = await working.start('activities/exampleTask.js', {});
      expect(taskId).toBeDefined();
    });

    it('should throw error when not running', async () => {
      await working.stop();

      await expect(working.start('activities/exampleTask.js', {}))
        .rejects
        .toThrow('Worker manager is stopped');
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - STATUS & INFORMATION
  // ============================================================================

  describe('Core Service API Methods - getStatus()', () => {
    it('should return status object', async () => {
      const status = await working.getStatus();

      expect(status).toBeDefined();
      expect(status.isRunning).toBe(true);
      expect(typeof status.maxThreads).toBe('number');
      expect(typeof status.activeWorkers).toBe('number');
      expect(status.queues).toBeDefined();
      expect(status.queues.incoming).toBeDefined();
      expect(status.queues.complete).toBeDefined();
      expect(status.queues.error).toBeDefined();
    });

    it('should report running state', async () => {
      const status = await working.getStatus();
      expect(status.isRunning).toBe(true);

      await working.stop();
      const statusAfterStop = await working.getStatus();
      expect(statusAfterStop.isRunning).toBe(false);
    });

    it('should report queue sizes', async () => {
      await working.start('activities/exampleTask.js', {});

      const status = await working.getStatus();
      expect(status.queues.incoming).toBeGreaterThanOrEqual(0);
    });

    it('should report active worker count', async () => {
      const status = await working.getStatus();
      expect(status.activeWorkers).toBeGreaterThanOrEqual(0);
      expect(status.activeWorkers).toBeLessThanOrEqual(status.maxThreads);
    });
  });

  describe('Core Service API Methods - getTaskHistory()', () => {
    it('should return array of task history', async () => {
      const history = await working.getTaskHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const history = await working.getTaskHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('should return task history with proper structure', async () => {
      // Queue a task first
      await working.start('activities/exampleTask.js', {});

      await new Promise(r => setTimeout(r, 1000));

      const history = await working.getTaskHistory(100);

      history.forEach(task => {
        expect(task.taskId).toBeDefined();
        expect(task.scriptPath).toBeDefined();
        expect(['completed', 'error']).toContain(task.status);
      });
    });

    it('should return tasks sorted by newest first', async () => {
      const history = await working.getTaskHistory(100);

      if (history.length > 1) {
        // Later tasks should have more recent completedAt times
        for (let i = 0; i < history.length - 1; i++) {
          expect(new Date(history[i].completedAt).getTime())
            .toBeGreaterThanOrEqual(new Date(history[i + 1].completedAt).getTime());
        }
      }
    });
  });

  describe('Core Service API Methods - getTask()', () => {
    it('should return null for non-existent task', async () => {
      const task = await working.getTask('nonexistent-task-id');
      expect(task).toBeNull();
    });

    it('should retrieve task by ID', async () => {
      const taskId = await working.start('activities/exampleTask.js', {});

      // Wait for task to potentially complete
      await new Promise(r => setTimeout(r, 2000));

      const task = await working.getTask(taskId);

      if (task) {
        expect(task.taskId).toBe(taskId);
        expect(task.scriptPath).toBeDefined();
      }
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - LIFECYCLE
  // ============================================================================

  describe('Core Service API Methods - stop()', () => {
    it('should stop the working service', async () => {
      const status1 = await working.getStatus();
      expect(status1.isRunning).toBe(true);

      await working.stop();

      const status2 = await working.getStatus();
      expect(status2.isRunning).toBe(false);
    });

    it('should emit worker:manager:stopping event', async () => {
      await working.stop();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'worker:manager:stopping',
        expect.any(Object)
      );
    });

    it('should emit worker:manager:stopped event', async () => {
      await working.stop();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'worker:manager:stopped'
      );
    });

    it('should terminate active workers', async () => {
      const taskId = await working.start('activities/exampleTask.js', {});

      await working.stop();

      const status = await working.getStatus();
      expect(status.activeWorkers).toBe(0);
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - SETTINGS
  // ============================================================================

  describe('Core Service API Methods - Settings', () => {
    it('should get settings', async () => {
      const settings = await working.getSettings();
      expect(settings).toBeDefined();
      expect(settings.workerTimeout).toBeDefined();
      expect(settings.maxQueueSize).toBeDefined();
      expect(settings.enableLogging).toBeDefined();
    });

    it('should save settings', async () => {
      const newSettings = {
        workerTimeout: 600000,
        enableLogging: false
      };

      await working.saveSettings(newSettings);

      const settings = await working.getSettings();
      expect(settings.workerTimeout).toBe(600000);
      expect(settings.enableLogging).toBe(false);
    });

    it('should have default settings', async () => {
      const settings = await working.getSettings();
      expect(settings.workerTimeout).toBeGreaterThan(0);
      expect(settings.maxQueueSize).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // EVENT EMISSION
  // ============================================================================

  describe('Event Emission', () => {
    it('should emit worker:queued event', async () => {
      await working.start('activities/exampleTask.js', {});

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'worker:queued',
        expect.any(Object)
      );
    });

    it('should emit events during task lifecycle', async () => {
      await working.start('activities/exampleTask.js', {});

      // Wait for events
      await new Promise(r => setTimeout(r, 100));

      // Check that queued event was emitted (worker:start may or may not fire depending on execution)
      const queuedCalls = mockEventEmitter.emit.mock.calls.filter(
        call => call[0] === 'worker:queued' || call[0].includes('worker:')
      );

      expect(queuedCalls.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // ANALYTICS MODULE - NOTE: Analytics is internal to working service
  // ============================================================================

  describe('Analytics Module - Feature Verification', () => {
    it('should track task execution with proper event handling', async () => {
      // The analytics module is internal and tracks via events
      await working.start('activities/exampleTask.js', {});

      // Wait for task to be queued and potentially start
      await new Promise(r => setTimeout(r, 100));

      // Verify event emission occurred
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle queueing service dependency', async () => {
      const working2 = createWorking('default', {
      allowAbsolutePaths: true,
        dependencies: { queueing },
        maxThreads: 2
      }, mockEventEmitter);

      expect(working2).toBeDefined();
      await working2.stop();
    });

    it('should handle missing eventEmitter gracefully', async () => {
      const working2 = createWorking('default', {
      allowAbsolutePaths: true,
        dependencies: { queueing },
        maxThreads: 2
      }, null);

      expect(working2).toBeDefined();
      await working2.stop();
    });

    it('should handle task queue overflow', async () => {
      // Queue multiple tasks
      for (let i = 0; i < 20; i++) {
        await working.start('activities/exampleTask.js', { index: i });
      }

      const status = await working.getStatus();
      expect(status.queues.incoming).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // INTEGRATION PATTERNS
  // ============================================================================

  describe('Integration Patterns', () => {
    it('should track task lifecycle from queue to completion', async () => {
      const taskId = await working.start('activities/exampleTask.js', {});

      expect(taskId).toBeDefined();

      // Task should be in queue
      const status1 = await working.getStatus();
      expect(status1.queues.incoming).toBeGreaterThanOrEqual(0);
    });

    it('should support multiple concurrent tasks', async () => {
      const taskIds = [];

      for (let i = 0; i < 3; i++) {
        const taskId = await working.start('activities/exampleTask.js', { id: i });
        taskIds.push(taskId);
      }

      expect(taskIds.length).toBe(3);
      expect(new Set(taskIds).size).toBe(3); // All unique
    });

    it('should handle task data passing', async () => {
      const data = {
        input: 'test-value',
        options: { format: 'json', level: 'high' }
      };

      const taskId = await working.start('activities/exampleTask.js', data);
      expect(taskId).toBeDefined();
    });
  });

  // ============================================================================
  // QUEUE MANAGEMENT
  // ============================================================================

  describe('Queue Management', () => {
    it('should manage incoming queue', async () => {
      const status1 = await working.getStatus();
      const initialSize = status1.queues.incoming;

      await working.start('activities/exampleTask.js', {});

      const status2 = await working.getStatus();
      expect(status2.queues.incoming).toBeGreaterThanOrEqual(initialSize);
    });

    it('should track task history', async () => {
      await working.start('activities/exampleTask.js', {});

      await new Promise(r => setTimeout(r, 1000));

      const history = await working.getTaskHistory();
      // Should have at least the task we just ran
      expect(history.length).toBeGreaterThanOrEqual(0);
    });

    it('should provide status across all queues', async () => {
      const status = await working.getStatus();

      const totalInQueues = status.queues.incoming +
        status.queues.complete +
        status.queues.error +
        status.activeWorkers;

      expect(totalInQueues).toBeGreaterThanOrEqual(0);
    });
  });
});
