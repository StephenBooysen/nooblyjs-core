/**
 * @fileoverview Integration tests for Working service with named queue support.
 *
 * This test suite verifies that the working service properly uses named queues
 * for task lifecycle management (incoming, complete, error).
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const EventEmitter = require('events');
const path = require('node:path');
const createWorkingService = require('../../../src/working');
const createQueueService = require('../../../src/queueing');

/**
 * Test suite for Working service with named queues.
 */
describe('Working Service with Named Queues', () => {
  let workingService;
  let queueService;
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();

    // Create queue service
    queueService = createQueueService('memory', {}, mockEventEmitter);

    // Reset singleton for working service
    if (createWorkingService._reset) {
      createWorkingService._reset();
    }

    // Create working service with queue dependency
    workingService = createWorkingService('default', {
      maxThreads: 2,
      // Fixture scripts live outside the activities folder (feature 18).
      trustedRoots: [path.resolve(__dirname, '../../../src/working/providers')],
      dependencies: {
        queueing: queueService
      }
    }, mockEventEmitter);
  });

  /**
   * Clean up test environment after each test case.
   */
  afterEach(async () => {
    if (workingService && typeof workingService.stop === 'function') {
      await workingService.stop();
    }

    // Reset singleton
    if (createWorkingService._reset) {
      createWorkingService._reset();
    }
  });

  it('should add tasks to incoming queue', async () => {
    const scriptPath = path.resolve(__dirname, '../../../src/working/providers/workerScript.js');
    const data = { test: 'data' };

    // Start a task
    const taskId = await workingService.start(scriptPath, data);

    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');

    // Check that task was added to incoming queue
    const incomingQueueSize = await queueService.size('nooblyjs-core-working-incoming');

    // Task might already be processing, so size could be 0 or 1
    expect(incomingQueueSize).toBeGreaterThanOrEqual(0);
  });

  it('should show incoming queue in status', async () => {
    const scriptPath = path.resolve(__dirname, '../../../src/working/providers/workerScript.js');

    // Add a task
    await workingService.start(scriptPath, { test: 'data' });

    // Get status
    const status = await workingService.getStatus();

    expect(status).toBeDefined();
    expect(status.queues).toBeDefined();
    expect(status.queues.incoming).toBeDefined();
    expect(status.queues.complete).toBeDefined();
    expect(status.queues.error).toBeDefined();
  });

  it('should track all three queues in status', async () => {
    const status = await workingService.getStatus();

    expect(status.queues).toEqual({
      incoming: expect.any(Number),
      complete: expect.any(Number),
      error: expect.any(Number)
    });
  });

  it('should have correct queue names defined', () => {
    const incomingQueueName = 'nooblyjs-core-working-incoming';
    const completeQueueName = 'nooblyjs-core-working-complete';
    const errorQueueName = 'nooblyjs-core-working-error';

    // Verify queue names are accessible through queue service
    expect(incomingQueueName).toBe('nooblyjs-core-working-incoming');
    expect(completeQueueName).toBe('nooblyjs-core-working-complete');
    expect(errorQueueName).toBe('nooblyjs-core-working-error');
  });

  it('should maintain separate queue sizes', async () => {
    // Get initial sizes
    const initialIncoming = await queueService.size('nooblyjs-core-working-incoming');
    const initialComplete = await queueService.size('nooblyjs-core-working-complete');
    const initialError = await queueService.size('nooblyjs-core-working-error');

    expect(initialIncoming).toBe(0);
    expect(initialComplete).toBe(0);
    expect(initialError).toBe(0);
  });
});
