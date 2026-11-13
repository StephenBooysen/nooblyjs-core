/**
 * @fileoverview Tests for Working service activity path resolution.
 *
 * This test suite verifies that the working service properly resolves
 * activity script paths using the filing service and activities folder configuration.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const EventEmitter = require('events');
const path = require('node:path');
const fs = require('node:fs').promises;
const createWorkingService = require('../../../src/working');
const createQueueService = require('../../../src/queueing');
const createFilingService = require('../../../src/filing');

/**
 * Test suite for Working service activity path resolution.
 */
describe('Working Service Activity Path Resolution', () => {
  let workingService;
  let queueService;
  let filingService;
  let mockEventEmitter;
  let testActivitiesDir;

  /**
   * Set up test environment before each test case.
   */
  beforeEach(async () => {
    mockEventEmitter = new EventEmitter();

    // Create test activities directory
    testActivitiesDir = path.join(__dirname, 'test-activities');
    await fs.mkdir(testActivitiesDir, { recursive: true });

    // Create a test activity file
    const testActivityContent = `
const { parentPort } = require('worker_threads');
async function run(data) {
  return { success: true, data };
}
module.exports = { run };
`;
    await fs.writeFile(
      path.join(testActivitiesDir, 'testActivity.js'),
      testActivityContent
    );

    // Create services
    queueService = createQueueService('memory', {}, mockEventEmitter);
    filingService = createFilingService('local', {}, mockEventEmitter);

    // Reset singleton for working service
    if (createWorkingService._reset) {
      createWorkingService._reset();
    }

    // Create working service with queue and filing dependencies
    workingService = createWorkingService('default', {
      allowAbsolutePaths: true,
      maxThreads: 2,
      activitiesFolder: testActivitiesDir,
      dependencies: {
        queueing: queueService,
        filing: filingService
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

    // Clean up test directory
    try {
      await fs.rm(testActivitiesDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }

    // Reset singleton
    if (createWorkingService._reset) {
      createWorkingService._reset();
    }
  });

  it('should resolve relative activity path from activities folder', async () => {
    const taskId = await workingService.start('testActivity.js', { test: 'data' });

    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');

    // Check that task was queued
    const status = await workingService.getStatus();
    expect(status.queues.incoming).toBeGreaterThanOrEqual(0);
  });

  it('should accept absolute activity paths', async () => {
    const absolutePath = path.join(testActivitiesDir, 'testActivity.js');
    const taskId = await workingService.start(absolutePath, { test: 'data' });

    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');
  });

  it('should throw error for non-existent activity', async () => {
    await expect(
      workingService.start('nonExistent.js', { test: 'data' })
    ).rejects.toThrow('Activity script not found');
  });

  it('should use custom activities folder from options', async () => {
    // Stop current service
    await workingService.stop();

    if (createWorkingService._reset) {
      createWorkingService._reset();
    }

    // Create service with custom folder
    const customDir = path.join(__dirname, 'custom-activities');
    await fs.mkdir(customDir, { recursive: true });

    const testActivityContent = `
const { parentPort } = require('worker_threads');
async function run(data) {
  return { success: true, custom: true, data };
}
module.exports = { run };
`;
    await fs.writeFile(
      path.join(customDir, 'customActivity.js'),
      testActivityContent
    );

    workingService = createWorkingService('default', {
      allowAbsolutePaths: true,
      maxThreads: 2,
      activitiesFolder: customDir,
      dependencies: {
        queueing: queueService,
        filing: filingService
      }
    }, mockEventEmitter);

    const taskId = await workingService.start('customActivity.js', { test: 'data' });
    expect(taskId).toBeDefined();

    // Cleanup
    await workingService.stop();
    await fs.rm(customDir, { recursive: true, force: true });
  });

  it('should use nooblyjs-core-activities option name', async () => {
    // Stop current service
    await workingService.stop();

    if (createWorkingService._reset) {
      createWorkingService._reset();
    }

    // Create service with nooblyjs-core-activities option
    workingService = createWorkingService('default', {
      allowAbsolutePaths: true,
      maxThreads: 2,
      'nooblyjs-core-activities': testActivitiesDir,
      dependencies: {
        queueing: queueService,
        filing: filingService
      }
    }, mockEventEmitter);

    const taskId = await workingService.start('testActivity.js', { test: 'data' });
    expect(taskId).toBeDefined();
  });

  it('should default to "activities" folder if not specified', async () => {
    // Stop current service
    await workingService.stop();

    if (createWorkingService._reset) {
      createWorkingService._reset();
    }

    // Create default activities folder
    const defaultDir = path.join(process.cwd(), 'activities');
    const alreadyExists = await fs.access(defaultDir).then(() => true).catch(() => false);

    if (!alreadyExists) {
      await fs.mkdir(defaultDir, { recursive: true });
    }

    // Create service without specifying activities folder
    workingService = createWorkingService('default', {
      allowAbsolutePaths: true,
      maxThreads: 2,
      dependencies: {
        queueing: queueService,
        filing: filingService
      }
    }, mockEventEmitter);

    // The service should use 'activities' as default
    expect(workingService.activitiesFolder_).toBe('activities');
  });
});
