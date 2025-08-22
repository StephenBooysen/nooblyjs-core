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

const path = require('path');
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
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    schedulerInstance = getSchedulerInstance('default', {}, mockEventEmitter);
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
  it('should stop all scheduled tasks', async () => {
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
    expect(workerInstanceMock.stop).toHaveBeenCalledTimes(1);
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
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:taskExecuted', {
      taskName,
      scriptPath: mockScriptPath,
      status: 'completed',
      data: 'some data',
    });
  });
});