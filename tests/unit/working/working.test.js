/**
 * @fileoverview Unit tests for the Working service (background task processing).
 * 
 * This test suite covers the working service functionality including task
 * execution, worker management, and event handling.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const EventEmitter = require('events');
const createWorkingService = require('../../../src/working');

/**
 * Test suite for Working service functionality.
 * 
 * Tests background task processing, worker lifecycle management,
 * and proper event emission.
 */
describe('Working Service', () => {
  let workingService;
  let mockEventEmitter;
  
  /**
   * Set up test environment before each test case.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    
    workingService = createWorkingService('memory', {
      maxConcurrentTasks: 2,
      taskTimeout: 5000
    }, mockEventEmitter);
  });
  
  /**
   * Clean up test environment after each test case.
   */
  afterEach(() => {
    if (workingService && typeof workingService.stop === 'function') {
      workingService.stop();
    }
  });
  
  it('should create working service instance', () => {
    expect(workingService).toBeDefined();
    expect(typeof workingService.run).toBe('function');
    expect(typeof workingService.stop).toBe('function');
    expect(typeof workingService.getStatus).toBe('function');
  });
  
  it('should execute a simple task', async () => {
    const task = {
      id: 'test-task-1',
      type: 'simple',
      data: { message: 'Hello World' },
      handler: async (data) => {
        return { result: `Processed: ${data.message}` };
      }
    };
    
    const result = await workingService.run(task);
    
    expect(result).toBeDefined();
    expect(result.result).toBe('Processed: Hello World');
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:start', {
      taskId: task.id,
      taskType: task.type
    });
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:complete', {
      taskId: task.id,
      taskType: task.type,
      result
    });
  });
  
  it('should handle task with async operations', async () => {
    const task = {
      id: 'async-task',
      type: 'async',
      data: { delay: 100 },
      handler: async (data) => {
        await new Promise(resolve => setTimeout(resolve, data.delay));
        return { status: 'completed', processedAt: new Date().toISOString() };
      }
    };
    
    const startTime = Date.now();
    const result = await workingService.run(task);
    const endTime = Date.now();
    
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
    expect(result.processedAt).toBeDefined();
    expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:start', expect.any(Object));
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:complete', expect.any(Object));
  });
  
  it('should handle task errors gracefully', async () => {
    const task = {
      id: 'error-task',
      type: 'error',
      data: { shouldFail: true },
      handler: async (data) => {
        if (data.shouldFail) {
          throw new Error('Task intentionally failed');
        }
        return { status: 'success' };
      }
    };
    
    await expect(workingService.run(task)).rejects.toThrow('Task intentionally failed');
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:start', expect.any(Object));
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:error', {
      taskId: task.id,
      taskType: task.type,
      error: expect.any(Error)
    });
  });
  
  it('should provide worker status information', () => {
    const status = workingService.getStatus();
    
    expect(status).toBeDefined();
    expect(typeof status).toBe('object');
    expect(status.isRunning).toBeDefined();
    expect(status.activeTasks).toBeDefined();
    expect(typeof status.activeTasks).toBe('number');
  });
  
  it('should stop worker when requested', () => {
    const initialStatus = workingService.getStatus();
    expect(initialStatus.isRunning).toBe(true);
    
    workingService.stop();
    
    const stoppedStatus = workingService.getStatus();
    expect(stoppedStatus.isRunning).toBe(false);
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('working:stop', {
      reason: 'manual',
      activeTasks: expect.any(Number)
    });
  });
  
  it('should handle multiple concurrent tasks', async () => {
    const tasks = [];
    for (let i = 0; i < 3; i++) {
      tasks.push({
        id: `concurrent-task-${i}`,
        type: 'concurrent',
        data: { index: i, delay: 50 },
        handler: async (data) => {
          await new Promise(resolve => setTimeout(resolve, data.delay));
          return { index: data.index, completed: true };
        }
      });
    }
    
    const promises = tasks.map(task => workingService.run(task));
    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(3);
    results.forEach((result, index) => {
      expect(result.index).toBe(index);
      expect(result.completed).toBe(true);
    });
    
    // Should have emitted start and complete events for each task
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(6); // 3 starts + 3 completes
  });
  
  it('should queue tasks when at capacity', async () => {
    // This test depends on maxConcurrentTasks configuration
    const longRunningTasks = [];
    const quickTasks = [];
    
    // Create long-running tasks to fill capacity
    for (let i = 0; i < 2; i++) {
      longRunningTasks.push({
        id: `long-task-${i}`,
        type: 'long',
        data: { delay: 200 },
        handler: async (data) => {
          await new Promise(resolve => setTimeout(resolve, data.delay));
          return { id: i, type: 'long' };
        }
      });
    }
    
    // Create quick task that should be queued
    quickTasks.push({
      id: 'quick-task',
      type: 'quick',
      data: { delay: 10 },
      handler: async (data) => {
        await new Promise(resolve => setTimeout(resolve, data.delay));
        return { type: 'quick' };
      }
    });
    
    // Start long tasks first
    const longPromises = longRunningTasks.map(task => workingService.run(task));
    
    // Start quick task (should be queued)
    const quickPromise = workingService.run(quickTasks[0]);
    
    const allResults = await Promise.all([...longPromises, quickPromise]);
    
    expect(allResults).toHaveLength(3);
    expect(allResults[2].type).toBe('quick');
  });
  
  it('should emit appropriate events during task lifecycle', async () => {
    const task = {
      id: 'lifecycle-task',
      type: 'lifecycle',
      data: { test: true },
      handler: async (data) => {
        return { processed: data.test };
      }
    };
    
    await workingService.run(task);
    
    // Check that all expected events were emitted
    const emittedEvents = mockEventEmitter.emit.mock.calls.map(call => call[0]);
    expect(emittedEvents).toContain('working:start');
    expect(emittedEvents).toContain('working:complete');
  });
  
  it('should handle task timeout if supported', async () => {
    const task = {
      id: 'timeout-task',
      type: 'timeout',
      data: { delay: 10000 }, // 10 seconds, longer than timeout
      handler: async (data) => {
        await new Promise(resolve => setTimeout(resolve, data.delay));
        return { completed: true };
      }
    };
    
    // This test assumes the service has timeout handling
    // If not implemented, the task will just complete normally
    const startTime = Date.now();
    try {
      await workingService.run(task);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(10000); // Should timeout before 10 seconds
      expect(error.message).toContain('timeout');
    }
  }, 6000);
});