/**
 * @fileoverview Unit tests for the scheduler service functionality.
 * 
 * This test suite covers the scheduler provider, testing task scheduling,
 * execution management, and worker integration. Tests verify proper task
 * lifecycle management, singleton behavior, and event emission.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const EventEmitter = require('events');

/**
 * Mock worker instance for testing scheduler functionality.
 * Provides mock implementations of worker start and stop methods.
 */
const workerInstanceMock = {
  start: jest.fn(),
  stop: jest.fn(),
};

/**
 * Mock the working module to return our mock worker instance.
 * This allows testing scheduler behavior without actual worker processes.
 */
jest.doMock('../../../src/working', () => {
  return jest.fn(() => workerInstanceMock);
});

const getSchedulerInstance = require('../../../src/scheduling');
const schedulingAnalytics = require('../../../src/scheduling/modules/analytics');

/**
 * Test suite for scheduler service operations.
 * 
 * Tests the scheduler functionality including task management,
 * singleton behavior, worker integration, and error handling.
 */
describe('SchedulerProvider', () => {
  /** @type {Object} Scheduler instance for testing */
  let schedulerInstance;
  /** @type {EventEmitter} Mock event emitter for testing scheduler events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh scheduler instance and clears all mocks.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore the default no-op implementation in case a previous test
    // installed its own (e.g. the concurrency test).
    workerInstanceMock.start.mockImplementation(() => {});
    workerInstanceMock.stop.mockImplementation(() => {});
    schedulingAnalytics.reset();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    // Provide working as a dependency so the singleton picks it up.
    schedulerInstance = getSchedulerInstance(
      'default',
      { dependencies: { working: workerInstanceMock } },
      mockEventEmitter
    );
  });

  /**
   * Clean up test environment after each test case.
   * Stops the scheduler and resets the singleton instance.
   */
  afterEach(async () => {
    await schedulerInstance.stop();
    getSchedulerInstance._reset();
  });

  /**
   * Test scheduler singleton behavior.
   * 
   * Verifies that multiple calls to getSchedulerInstance return
   * the same instance.
   */
  it('should be a singleton', () => {
    const anotherInstance = getSchedulerInstance('default', {}, mockEventEmitter);
    expect(schedulerInstance).toBe(anotherInstance);
  });

  /**
   * Test starting a scheduled task.
   * 
   * Verifies that tasks can be started with proper worker integration
   * and event emission.
   */
  it('should start a scheduled task', async () => {
    const taskName = 'testTask';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;

    await schedulerInstance.start(taskName, mockScriptPath, mockInterval);

    expect(workerInstanceMock.start).toHaveBeenCalledWith(mockScriptPath, null, expect.any(Function));
    expect(await schedulerInstance.isRunning(taskName)).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:started', {
      taskName,
      scriptPath: mockScriptPath,
      intervalSeconds: mockInterval,
    });
  });

  /**
   * Test starting multiple scheduled tasks.
   * 
   * Verifies that multiple tasks can run simultaneously and are
   * properly tracked by the scheduler.
   */
  it('should start multiple scheduled tasks', async () => {
    const task1 = 'task1';
    const task2 = 'task2';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;

    await schedulerInstance.start(task1, mockScriptPath, mockInterval);
    await schedulerInstance.start(task2, mockScriptPath, mockInterval);

    expect(await schedulerInstance.isRunning(task1)).toBe(true);
    expect(await schedulerInstance.isRunning(task2)).toBe(true);
    expect(await schedulerInstance.isRunning()).toBe(true);
  });

  /**
   * Test stopping a specific scheduled task.
   * 
   * Verifies that individual tasks can be stopped while leaving
   * other tasks running.
   */
  it('should stop a specific scheduled task', async () => {
    const task1 = 'task1';
    const task2 = 'task2';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;

    await schedulerInstance.start(task1, mockScriptPath, mockInterval);
    await schedulerInstance.start(task2, mockScriptPath, mockInterval);

    await schedulerInstance.stop(task1);

    expect(await schedulerInstance.isRunning(task1)).toBe(false);
    expect(await schedulerInstance.isRunning(task2)).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:stopped', { taskName: task1 });
  });

  /**
   * Test stopping all scheduled tasks.
   * 
   * Verifies that all running tasks can be stopped at once
   * with proper cleanup and event emission.
   */
  it('should stop all scheduled tasks without stopping the shared worker', async () => {
    const task1 = 'task1';
    const task2 = 'task2';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;

    await schedulerInstance.start(task1, mockScriptPath, mockInterval);
    await schedulerInstance.start(task2, mockScriptPath, mockInterval);

    await schedulerInstance.stop();

    expect(await schedulerInstance.isRunning(task1)).toBe(false);
    expect(await schedulerInstance.isRunning(task2)).toBe(false);
    expect(await schedulerInstance.isRunning()).toBe(false);
    // The scheduler must not stop the shared working service — other parts
    // of the framework rely on it.
    expect(workerInstanceMock.stop).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:stopped', { taskName: task1 });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:stopped', { taskName: task2 });
  });

  /**
   * Test duplicate task name handling.
   * 
   * Verifies that attempting to start a task with an existing name
   * is prevented and emits an appropriate error event.
   */
  it('should not start a task if another with the same name is already running', async () => {
    const taskName = 'testTask';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;

    await schedulerInstance.start(taskName, mockScriptPath, mockInterval);
    await schedulerInstance.start(taskName, mockScriptPath, mockInterval); // Try to start again

    expect(workerInstanceMock.start).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:start:error', {
      taskName,
      error: 'Task already scheduled.',
    });
  });

  /**
   * Test task execution callback and event handling.
   * 
   * Verifies that task execution results are properly handled
   * and forwarded to callback functions with event emission.
   */
  it('should handle task execution and emit event', async () => {
    const taskName = 'testTask';
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    const mockInterval = 1;
    const executionCallback = jest.fn();

    await schedulerInstance.start(taskName, mockScriptPath, mockInterval, executionCallback);

    const workerCallback = workerInstanceMock.start.mock.calls[0][2];
    workerCallback('completed', 'some data');

    expect(executionCallback).toHaveBeenCalledWith('completed', 'some data');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'scheduler:taskExecuted',
      expect.objectContaining({
        taskName,
        scriptPath: mockScriptPath,
        status: 'completed',
        data: 'some data',
      })
    );
  });

  /**
   * CRON expression validation.
   *
   * Verifies that startCron rejects malformed expressions before any state
   * is registered, and stores valid CRON tasks in the schedule list.
   */
  it('should validate cron expressions', async () => {
    await expect(
      schedulerInstance.startCron({ scriptPath: 'job.js' }, 'not-a-cron', 'bad-cron-task')
    ).rejects.toThrow(/Invalid cron expression/);

    expect(await schedulerInstance.isRunning('bad-cron-task')).toBe(false);

    const name = await schedulerInstance.startCron(
      { scriptPath: 'job.js' },
      '*/5 * * * *',
      'good-cron-task'
    );
    expect(name).toBe('good-cron-task');
    expect(await schedulerInstance.isRunning('good-cron-task')).toBe(true);
  });

  /**
   * Live schedule listing.
   *
   * Verifies that listSchedules and getSchedule return serialisable
   * snapshots of currently registered tasks.
   */
  it('should expose listSchedules and getSchedule', async () => {
    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    await schedulerInstance.start('list-task', mockScriptPath, 60);
    await schedulerInstance.startCron({ scriptPath: 'job.js' }, '0 * * * *', 'cron-task');

    const schedules = await schedulerInstance.listSchedules();
    expect(schedules).toHaveLength(2);

    const intervalSummary = await schedulerInstance.getSchedule('list-task');
    expect(intervalSummary).toMatchObject({
      name: 'list-task',
      type: 'interval',
      intervalSeconds: 60
    });

    const cronSummary = await schedulerInstance.getSchedule('cron-task');
    expect(cronSummary).toMatchObject({
      name: 'cron-task',
      type: 'cron',
      cron: '0 * * * *'
    });

    expect(await schedulerInstance.getSchedule('does-not-exist')).toBeNull();
  });

  /**
   * Concurrency limit enforcement.
   *
   * Verifies that the maxConcurrentJobs setting prevents new executions
   * from starting when the cap is reached, emitting a skip event instead.
   */
  it('should skip executions when at maxConcurrentJobs cap', async () => {
    await schedulerInstance.saveSettings({ maxConcurrentJobs: 1 });

    // Worker.start never invokes its callback in this test, so the first
    // execution stays "in flight" and the next start() call should be
    // skipped due to the concurrency cap.
    workerInstanceMock.start.mockImplementation(() => {});

    const mockScriptPath = path.resolve(__dirname, 'mockScript.js');
    await schedulerInstance.start('first', mockScriptPath, 60);
    await schedulerInstance.start('second', mockScriptPath, 60);

    // First task fires once and consumes the only slot. Second task is
    // immediately skipped at fire time.
    expect(workerInstanceMock.start).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'scheduler:execution-skipped',
      expect.objectContaining({ taskName: 'second', reason: 'maxConcurrentJobs' })
    );
  });

  /**
   * Settings update event emission.
   *
   * Verifies that saveSettings emits a setting-changed event for each
   * accepted setting and applies the new values.
   */
  it('should update settings and emit setting-changed events', async () => {
    await schedulerInstance.saveSettings({
      maxConcurrentJobs: 25,
      retryAttempts: 5,
      jobTimeout: 60000
    });

    const settings = await schedulerInstance.getSettings();
    expect(settings.maxConcurrentJobs).toBe(25);
    expect(settings.retryAttempts).toBe(5);
    expect(settings.jobTimeout).toBe(60000);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'scheduler:setting-changed',
      expect.objectContaining({ setting: 'maxConcurrentJobs', value: 25 })
    );
  });
});