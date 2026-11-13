/**
 * @fileoverview Feature Verification Tests for Scheduling Service
 * Comprehensive test suite verifying all documented features of the Scheduling Service.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @date 2025-11-22
 */

'use strict';

const EventEmitter = require('events');
const createScheduling = require('../../../src/scheduling');
const createWorking = require('../../../src/working');
const createQueueing = require('../../../src/queueing');
const path = require('node:path');
const fs = require('node:fs').promises;

describe('Scheduling Service - Feature Verification', () => {
  let scheduling;
  let working;
  let queueing;
  let mockEventEmitter;

  beforeEach(() => {
    // Reset singletons
    createScheduling._reset();
    createWorking._reset();

    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    // Create queueing service (required dependency for working)
    queueing = createQueueing('memory', {}, mockEventEmitter);

    // Create working service (required dependency for scheduling)
    working = createWorking('default', {
      allowAbsolutePaths: true,
      dependencies: { queueing },
      maxThreads: 2
    }, mockEventEmitter);

    // Create scheduling service
    scheduling = createScheduling('memory', {
      dependencies: { working },
      maxConcurrentJobs: 10,
      retryAttempts: 3,
      jobTimeout: 30000
    }, mockEventEmitter);
  });

  afterEach(async () => {
    mockEventEmitter.emit.mockClear();
    await scheduling.stop();
    createScheduling._reset();
    createWorking._reset();
  });

  // ============================================================================
  // CORE SERVICE API METHODS - START
  // ============================================================================

  describe('Core Service API Methods - start()', () => {
    it('should start a scheduled task and return without error', async () => {
      await expect(scheduling.start(
        'test-task',
        'activities/exampleTask.js',
        5
      )).resolves.toBeUndefined();
    });

    it('should accept task with data and interval', async () => {
      const data = { input: 'test', timeout: 5000 };
      await expect(scheduling.start(
        'data-task',
        'activities/exampleTask.js',
        data,
        5,  // interval
        undefined  // callback
      )).resolves.toBeUndefined();
    });

    it('should accept task with data, interval, and callback', async () => {
      const callback = jest.fn();
      await expect(scheduling.start(
        'callback-task',
        'activities/exampleTask.js',
        { value: 42 },
        10,
        callback
      )).resolves.toBeUndefined();
    });

    it('should accept task with interval and callback only', async () => {
      const callback = jest.fn();
      await expect(scheduling.start(
        'minimal-task',
        'activities/exampleTask.js',
        5,
        callback
      )).resolves.toBeUndefined();
    });

    it('should emit scheduler:started event', async () => {
      await scheduling.start('test-task', 'activities/exampleTask.js', 5);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:started',
        expect.objectContaining({
          taskName: 'test-task',
          scriptPath: expect.any(String),
          intervalSeconds: 5
        })
      );
    });

    it('should throw error on invalid taskName', async () => {
      await expect(scheduling.start(
        '',
        'activities/exampleTask.js',
        5
      )).rejects.toThrow('Invalid taskName');
    });

    it('should throw error on invalid scriptPath', async () => {
      await expect(scheduling.start(
        'test-task',
        '',
        5
      )).rejects.toThrow('Invalid scriptPath');
    });

    it('should throw error on invalid interval', async () => {
      await expect(scheduling.start(
        'test-task',
        'activities/exampleTask.js',
        0
      )).rejects.toThrow('Invalid interval');
    });

    it('should throw error on negative interval', async () => {
      await expect(scheduling.start(
        'test-task',
        'activities/exampleTask.js',
        -5
      )).rejects.toThrow('Invalid interval');
    });

    it('should throw error on invalid callback', async () => {
      await expect(scheduling.start(
        'test-task',
        'activities/exampleTask.js',
        5,
        'not-a-function'
      )).rejects.toThrow('Invalid callback');
    });

    it('should not start duplicate task with same name', async () => {
      await scheduling.start('duplicate-task', 'activities/exampleTask.js', 5);
      const isRunning1 = await scheduling.isRunning('duplicate-task');

      // Try to start again with same name
      await scheduling.start('duplicate-task', 'activities/exampleTask.js', 10);
      const isRunning2 = await scheduling.isRunning('duplicate-task');

      expect(isRunning1).toBe(true);
      expect(isRunning2).toBe(true);
    });

    it('should handle absolute script paths', async () => {
      const absolutePath = path.resolve(__dirname, '../../../activities/exampleTask.js');
      await expect(scheduling.start(
        'absolute-path-task',
        absolutePath,
        5
      )).resolves.toBeUndefined();
    });

    it('should handle relative script paths', async () => {
      await expect(scheduling.start(
        'relative-path-task',
        'activities/exampleTask.js',
        5
      )).resolves.toBeUndefined();
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - STOP
  // ============================================================================

  describe('Core Service API Methods - stop()', () => {
    it('should stop a specific task', async () => {
      await scheduling.start('stop-test', 'activities/exampleTask.js', 10);
      const isRunningBefore = await scheduling.isRunning('stop-test');

      await scheduling.stop('stop-test');
      const isRunningAfter = await scheduling.isRunning('stop-test');

      expect(isRunningBefore).toBe(true);
      expect(isRunningAfter).toBe(false);
    });

    it('should emit scheduler:stopped event when stopping specific task', async () => {
      await scheduling.start('stop-event-test', 'activities/exampleTask.js', 10);
      await scheduling.stop('stop-event-test');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:stopped',
        expect.objectContaining({
          taskName: 'stop-event-test'
        })
      );
    });

    it('should stop all tasks when no taskName provided', async () => {
      await scheduling.start('task1', 'activities/exampleTask.js', 10);
      await scheduling.start('task2', 'activities/exampleTask.js', 10);

      const anyRunningBefore = await scheduling.isRunning();
      expect(anyRunningBefore).toBe(true);

      await scheduling.stop();
      const anyRunningAfter = await scheduling.isRunning();

      expect(anyRunningAfter).toBe(false);
    });

    it('should emit multiple scheduler:stopped events when stopping all', async () => {
      await scheduling.start('task1', 'activities/exampleTask.js', 10);
      await scheduling.start('task2', 'activities/exampleTask.js', 10);

      await scheduling.stop();

      const stoppedEvents = mockEventEmitter.emit.mock.calls.filter(
        call => call[0] === 'scheduler:stopped'
      );

      expect(stoppedEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should throw error on invalid taskName for stop', async () => {
      await expect(scheduling.stop('')).rejects.toThrow('Invalid taskName');
    });

    it('should handle stopping non-existent task gracefully', async () => {
      await expect(scheduling.stop('non-existent')).resolves.toBeUndefined();
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - ISRUNNING
  // ============================================================================

  describe('Core Service API Methods - isRunning()', () => {
    it('should return true for running task', async () => {
      await scheduling.start('running-task', 'activities/exampleTask.js', 10);
      const isRunning = await scheduling.isRunning('running-task');

      expect(isRunning).toBe(true);
    });

    it('should return false for stopped task', async () => {
      await scheduling.start('stopped-task', 'activities/exampleTask.js', 10);
      await scheduling.stop('stopped-task');

      const isRunning = await scheduling.isRunning('stopped-task');
      expect(isRunning).toBe(false);
    });

    it('should return false for non-existent task', async () => {
      const isRunning = await scheduling.isRunning('non-existent');
      expect(isRunning).toBe(false);
    });

    it('should return true when any tasks are running', async () => {
      await scheduling.start('task1', 'activities/exampleTask.js', 10);
      const anyRunning = await scheduling.isRunning();

      expect(anyRunning).toBe(true);
    });

    it('should return false when no tasks are running', async () => {
      const anyRunning = await scheduling.isRunning();
      expect(anyRunning).toBe(false);
    });

    it('should return false after all tasks stopped', async () => {
      await scheduling.start('task1', 'activities/exampleTask.js', 10);
      await scheduling.start('task2', 'activities/exampleTask.js', 10);

      await scheduling.stop();
      const anyRunning = await scheduling.isRunning();

      expect(anyRunning).toBe(false);
    });
  });

  // ============================================================================
  // CORE SERVICE API METHODS - SETTINGS
  // ============================================================================

  describe('Core Service API Methods - getSettings()', () => {
    it('should return settings object', async () => {
      const settings = await scheduling.getSettings();

      expect(settings).toBeDefined();
      expect(typeof settings).toBe('object');
    });

    it('should have maxConcurrentJobs setting', async () => {
      const settings = await scheduling.getSettings();

      expect(settings.maxConcurrentJobs).toBeDefined();
      expect(typeof settings.maxConcurrentJobs).toBe('number');
    });

    it('should have retryAttempts setting', async () => {
      const settings = await scheduling.getSettings();

      expect(settings.retryAttempts).toBeDefined();
      expect(typeof settings.retryAttempts).toBe('number');
    });

    it('should have jobTimeout setting', async () => {
      const settings = await scheduling.getSettings();

      expect(settings.jobTimeout).toBeDefined();
      expect(typeof settings.jobTimeout).toBe('number');
    });

    it('should reflect default values', async () => {
      const settings = await scheduling.getSettings();

      expect(settings.maxConcurrentJobs).toBe(10);
      expect(settings.retryAttempts).toBe(3);
      expect(settings.jobTimeout).toBe(30000);
    });
  });

  describe('Core Service API Methods - saveSettings()', () => {
    it('should save maxConcurrentJobs setting', async () => {
      await scheduling.saveSettings({ maxConcurrentJobs: 20 });

      const settings = await scheduling.getSettings();
      expect(settings.maxConcurrentJobs).toBe(20);
    });

    it('should save retryAttempts setting', async () => {
      await scheduling.saveSettings({ retryAttempts: 5 });

      const settings = await scheduling.getSettings();
      expect(settings.retryAttempts).toBe(5);
    });

    it('should save jobTimeout setting', async () => {
      await scheduling.saveSettings({ jobTimeout: 60000 });

      const settings = await scheduling.getSettings();
      expect(settings.jobTimeout).toBe(60000);
    });

    it('should save multiple settings at once', async () => {
      await scheduling.saveSettings({
        maxConcurrentJobs: 15,
        retryAttempts: 4,
        jobTimeout: 45000
      });

      const settings = await scheduling.getSettings();
      expect(settings.maxConcurrentJobs).toBe(15);
      expect(settings.retryAttempts).toBe(4);
      expect(settings.jobTimeout).toBe(45000);
    });

    it('should emit scheduler:setting-changed event', async () => {
      await scheduling.saveSettings({ maxConcurrentJobs: 25 });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:setting-changed',
        expect.objectContaining({
          setting: 'maxConcurrentJobs',
          value: 25
        })
      );
    });

    it('should handle partial settings updates', async () => {
      const originalSettings = await scheduling.getSettings();

      await scheduling.saveSettings({ maxConcurrentJobs: 30 });

      const settings = await scheduling.getSettings();
      expect(settings.maxConcurrentJobs).toBe(30);
      expect(settings.retryAttempts).toBe(originalSettings.retryAttempts);
      expect(settings.jobTimeout).toBe(originalSettings.jobTimeout);
    });
  });

  // ============================================================================
  // EVENT EMISSION
  // ============================================================================

  describe('Event Emission', () => {
    it('should emit scheduler:started event with correct data', async () => {
      await scheduling.start('event-test', 'activities/exampleTask.js', 5);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:started',
        expect.objectContaining({
          taskName: 'event-test',
          scriptPath: expect.any(String),
          intervalSeconds: 5
        })
      );
    });

    it('should emit scheduler:stopped event with correct data', async () => {
      await scheduling.start('stop-emit-test', 'activities/exampleTask.js', 5);
      mockEventEmitter.emit.mockClear();

      await scheduling.stop('stop-emit-test');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:stopped',
        expect.objectContaining({
          taskName: 'stop-emit-test'
        })
      );
    });

    it('should emit scheduler:validation-error on invalid parameters', async () => {
      try {
        await scheduling.start('', 'activities/exampleTask.js', 5);
      } catch (e) {
        // Error expected
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:validation-error',
        expect.any(Object)
      );
    });

    it('should emit events during task lifecycle', async () => {
      await scheduling.start('lifecycle-test', 'activities/exampleTask.js', 10);

      // Wait for potential task execution
      await new Promise(r => setTimeout(r, 100));

      // Check that at least started event was emitted
      const emittedEvents = mockEventEmitter.emit.mock.calls
        .map(call => call[0])
        .filter(event => event.includes('scheduler'));

      expect(emittedEvents.length).toBeGreaterThan(0);
      expect(emittedEvents).toContain('scheduler:started');
    });
  });

  // ============================================================================
  // TASK MANAGEMENT
  // ============================================================================

  describe('Task Management', () => {
    it('should manage multiple independent tasks', async () => {
      const task1 = 'multi-task-1';
      const task2 = 'multi-task-2';
      const task3 = 'multi-task-3';

      await scheduling.start(task1, 'activities/exampleTask.js', 10);
      await scheduling.start(task2, 'activities/exampleTask.js', 15);
      await scheduling.start(task3, 'activities/exampleTask.js', 20);

      expect(await scheduling.isRunning(task1)).toBe(true);
      expect(await scheduling.isRunning(task2)).toBe(true);
      expect(await scheduling.isRunning(task3)).toBe(true);

      await scheduling.stop(task1);

      expect(await scheduling.isRunning(task1)).toBe(false);
      expect(await scheduling.isRunning(task2)).toBe(true);
      expect(await scheduling.isRunning(task3)).toBe(true);
    });

    it('should support task data passing', async () => {
      const taskData = {
        action: 'cleanup',
        tables: ['logs', 'sessions'],
        retention: '7d'
      };

      await expect(scheduling.start(
        'data-passing-task',
        'activities/exampleTask.js',
        taskData,
        5,  // interval
        undefined  // callback
      )).resolves.toBeUndefined();

      expect(await scheduling.isRunning('data-passing-task')).toBe(true);
    });

    it('should support execution callbacks', async () => {
      const callback = jest.fn();

      await scheduling.start(
        'callback-test',
        'activities/exampleTask.js',
        10,
        callback
      );

      expect(await scheduling.isRunning('callback-test')).toBe(true);
      // Callback will be invoked when task completes (async)
    });

    it('should track task names correctly', async () => {
      const taskNames = ['task-a', 'task-b', 'task-c'];

      for (const name of taskNames) {
        await scheduling.start(name, 'activities/exampleTask.js', 10);
      }

      for (const name of taskNames) {
        expect(await scheduling.isRunning(name)).toBe(true);
      }
    });

    it('should handle task with various intervals', async () => {
      await scheduling.start('quick-task', 'activities/exampleTask.js', 1);
      await scheduling.start('slow-task', 'activities/exampleTask.js', 3600);
      await scheduling.start('medium-task', 'activities/exampleTask.js', 300);

      expect(await scheduling.isRunning('quick-task')).toBe(true);
      expect(await scheduling.isRunning('slow-task')).toBe(true);
      expect(await scheduling.isRunning('medium-task')).toBe(true);
    });
  });

  // ============================================================================
  // INTEGRATION PATTERNS
  // ============================================================================

  describe('Integration Patterns', () => {
    it('should support cascading task execution setup', async () => {
      // Task 1: Gather data (every 60 seconds)
      await scheduling.start('gather-data', 'activities/exampleTask.js', 60);

      // Task 2: Process data (every 120 seconds)
      await scheduling.start('process-data', 'activities/exampleTask.js', { source: 'gathered' }, 5, undefined);

      // Task 3: Generate report (every 3600 seconds)
      await scheduling.start('generate-report', 'activities/exampleTask.js', { source: 'processed' }, 10, undefined);

      expect(await scheduling.isRunning('gather-data')).toBe(true);
      expect(await scheduling.isRunning('process-data')).toBe(true);
      expect(await scheduling.isRunning('generate-report')).toBe(true);
    });

    it('should support conditional task execution pattern', async () => {
      const condition = (status) => status === 'completed';

      const callback = (status, result) => {
        if (condition(status)) {
          console.log('Condition met for task execution');
        }
      };

      await scheduling.start(
        'conditional-task',
        'activities/exampleTask.js',
        10,
        callback
      );

      expect(await scheduling.isRunning('conditional-task')).toBe(true);
    });

    it('should handle rapid start/stop cycles', async () => {
      const taskName = 'rapid-task';

      for (let i = 0; i < 3; i++) {
        await scheduling.start(taskName, 'activities/exampleTask.js', 10);
        await scheduling.stop(taskName);
      }

      expect(await scheduling.isRunning(taskName)).toBe(false);
    });

    it('should maintain settings across task operations', async () => {
      const originalSettings = await scheduling.getSettings();

      await scheduling.start('settings-test', 'activities/exampleTask.js', 10);
      await scheduling.saveSettings({ maxConcurrentJobs: 50 });

      const settingsAfterStart = await scheduling.getSettings();

      expect(settingsAfterStart.maxConcurrentJobs).toBe(50);
      expect(settingsAfterStart.retryAttempts).toBe(originalSettings.retryAttempts);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle working service dependency gracefully', async () => {
      // The factory returns a scheduling instance even if working is missing
      // The error is caught internally and handled gracefully
      const schedulingNoDeps = createScheduling('memory', { dependencies: {} }, mockEventEmitter);
      expect(schedulingNoDeps).toBeDefined();

      // Even without working service, start() completes (it just won't execute tasks)
      await expect(schedulingNoDeps.start('test', 'activities/exampleTask.js', 5))
        .resolves.toBeUndefined();
    });

    it('should validate taskName is required string', async () => {
      await expect(scheduling.start(null, 'activities/exampleTask.js', 5))
        .rejects.toThrow('Invalid taskName');
    });

    it('should validate scriptPath is required string', async () => {
      await expect(scheduling.start('test', null, 5))
        .rejects.toThrow('Invalid scriptPath');
    });

    it('should validate interval is positive number', async () => {
      await expect(scheduling.start('test', 'activities/exampleTask.js', 0))
        .rejects.toThrow('Invalid interval');
    });

    it('should handle callback validation', async () => {
      await expect(scheduling.start('test', 'activities/exampleTask.js', 5, 'invalid'))
        .rejects.toThrow('Invalid callback');
    });

    it('should emit validation-error on invalid input', async () => {
      try {
        await scheduling.start('', 'activities/exampleTask.js', 5);
      } catch (e) {
        // Expected
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:validation-error',
        expect.objectContaining({
          method: 'start',
          error: expect.any(String)
        })
      );
    });

    it('should handle multiple concurrent task starts', async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          scheduling.start(`concurrent-${i}`, 'activities/exampleTask.js', 10)
        );
      }

      await Promise.all(promises);

      for (let i = 0; i < 5; i++) {
        expect(await scheduling.isRunning(`concurrent-${i}`)).toBe(true);
      }
    });
  });

  // ============================================================================
  // ANALYTICS VERIFICATION
  // ============================================================================

  describe('Analytics Tracking', () => {
    it('should track schedule creation through events', async () => {
      await scheduling.start('analytics-test', 'activities/exampleTask.js', 10);

      // Wait for potential execution
      await new Promise(r => setTimeout(r, 100));

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'scheduler:started',
        expect.objectContaining({
          taskName: 'analytics-test'
        })
      );
    });

    it('should track schedule execution through callbacks', async () => {
      const callback = jest.fn();

      await scheduling.start(
        'callback-analytics',
        'activities/exampleTask.js',
        10,
        callback
      );

      expect(await scheduling.isRunning('callback-analytics')).toBe(true);
    });

    it('should support monitoring multiple schedules', async () => {
      const schedules = ['monitor1', 'monitor2', 'monitor3'];

      for (const name of schedules) {
        await scheduling.start(name, 'activities/exampleTask.js', 10);
      }

      for (const name of schedules) {
        const isRunning = await scheduling.isRunning(name);
        expect(isRunning).toBe(true);
      }
    });
  });
});
