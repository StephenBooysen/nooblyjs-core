/**
 * @fileoverview Unit tests for the workflow service functionality.
 * 
 * This test suite covers the workflow service provider, testing workflow
 * definition, execution, step management, and error handling. Tests verify
 * proper step execution order, data passing between steps, and event emission.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const path = require('path');
const createWorkflowService = require('../../../src/workflow');
const EventEmitter = require('events');

/**
 * Mock worker_threads to prevent actual worker processes during testing.
 * Provides mock implementations of Worker functionality.
 */
jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    terminate: jest.fn(),
  })),
}));

/**
 * Test suite for workflow service operations.
 * 
 * Tests the workflow service functionality including workflow definition,
 * step execution, data flow, and error handling scenarios.
 */
describe('WorkflowService', () => {
  /** @type {string} Path to mock error step for testing error scenarios */
  const errorStepPath = path.resolve(__dirname, '../mocks/errorStep.js');

  /**
   * Set up mock for error step before all tests.
   * Creates a virtual mock that throws an error when executed.
   */
  beforeAll(() => {
    // Mock the error step to throw an error
    jest.mock(
      errorStepPath,
      () =>
        jest.fn(() => {
          throw new Error('Simulated step error');
        }),
      { virtual: true },
    );
  });

  /** @type {Object} Workflow service instance for testing */
  let workflowService;
  /** @type {jest.Mock} Mock callback for workflow status updates */
  let mockStatusCallback;
  /** @type {EventEmitter} Mock event emitter for testing workflow events */
  let mockEventEmitter;

  /** @type {string} Path to first example step */
  const step1Path = path.resolve(__dirname, './steps/exampleStep1.js');
  /** @type {string} Path to second example step */
  const step2Path = path.resolve(__dirname, './steps/exampleStep2.js');

  /**
   * Set up test environment before each test case.
   * Creates fresh workflow service instance and mock callbacks.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    workflowService = createWorkflowService('default', {}, mockEventEmitter);
    mockStatusCallback = jest.fn();
  });

  /**
   * Clean up test environment after each test case.
   * Ensures proper cleanup of workflow resources.
   */
  afterEach(() => {
    // Clean up any resources
    if (workflowService && workflowService.cleanup) {
      workflowService.cleanup();
    }
  });

  /**
   * Test workflow definition functionality.
   * 
   * Verifies that workflows can be defined with a list of steps
   * and that proper events are emitted.
   */
  it('should define a workflow with given steps', () => {
    const workflowName = 'testWorkflow';
    const steps = [step1Path, step2Path];
    workflowService.defineWorkflow(workflowName, steps);
    expect(workflowService.workflows.get(workflowName)).toEqual(steps);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:defined', {
      workflowName,
      steps,
    });
  });

  /**
   * Test workflow execution and data flow between steps.
   * 
   * Verifies that workflows execute steps in order, pass data between
   * steps, and emit appropriate events throughout execution.
   */
  it('should run a defined workflow and pass data between steps', async () => {
    const workflowName = 'testWorkflow';
    const initialData = { start: true };
    const steps = [step1Path, step2Path];
    workflowService.defineWorkflow(workflowName, steps);
    mockEventEmitter.emit.mockClear(); // Clear emits from defineWorkflow

    await workflowService.runWorkflow(
      workflowName,
      initialData,
      mockStatusCallback,
    );

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:start', {
      workflowName,
      initialData,
    });

    // Expect step_start and step_end for each step
    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_start',
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: initialData,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:start', {
      workflowName,
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: initialData,
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_end',
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: expect.objectContaining({ step1Processed: true }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:end', {
      workflowName,
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: expect.objectContaining({ step1Processed: true }),
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_start',
      stepName: `Step 2: ${path.basename(step2Path)}`,
      stepPath: step2Path,
      data: expect.objectContaining({ step1Processed: true }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:start', {
      workflowName,
      stepName: `Step 2: ${path.basename(step2Path)}`,
      stepPath: step2Path,
      data: expect.objectContaining({ step1Processed: true }),
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_end',
      stepName: `Step 2: ${path.basename(step2Path)}`,
      stepPath: step2Path,
      data: expect.objectContaining({
        step1Processed: true,
        step2Processed: true,
      }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:end', {
      workflowName,
      stepName: `Step 2: ${path.basename(step2Path)}`,
      stepPath: step2Path,
      data: expect.objectContaining({
        step1Processed: true,
        step2Processed: true,
      }),
    });

    // Expect workflow_complete
    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'workflow_complete',
      workflowName,
      finalData: expect.objectContaining({
        step1Processed: true,
        step2Processed: true,
      }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:complete', {
      workflowName,
      finalData: expect.objectContaining({
        step1Processed: true,
        step2Processed: true,
      }),
    });

    // Ensure callbacks were called in the correct order and number of times
    expect(mockStatusCallback).toHaveBeenCalledTimes(5); // 2 start, 2 end, 1 complete
  });

  /**
   * Test error handling for non-existent workflows.
   * 
   * Verifies that attempting to run a non-existent workflow throws
   * an appropriate error and emits error events.
   */
  it('should throw an error if workflow is not found', async () => {
    const workflowName = 'nonExistentWorkflow';
    const initialData = {};

    await expect(
      workflowService.runWorkflow(
        workflowName,
        initialData,
        mockStatusCallback,
      ),
    ).rejects.toThrow(`Workflow '${workflowName}' not found.`);

    expect(mockStatusCallback).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:error', {
      workflowName,
      error: `Workflow '${workflowName}' not found.`,
    });
  });

  /**
   * Test error handling within workflow steps.
   * 
   * Verifies that errors in workflow steps are properly caught,
   * handled, and reported with appropriate events.
   */
  it('should handle errors within a workflow step', async () => {
    const workflowName = 'errorWorkflow';
    const steps = [step1Path, errorStepPath];
    workflowService.defineWorkflow(workflowName, steps);

    const initialData = { test: 'error' };

    await expect(
      workflowService.runWorkflow(
        workflowName,
        initialData,
        mockStatusCallback,
      ),
    ).rejects.toThrow('Simulated step error');

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_start',
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: initialData,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:start', {
      workflowName,
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: initialData,
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_end',
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: expect.objectContaining({ step1Processed: true }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:end', {
      workflowName,
      stepName: `Step 1: ${path.basename(step1Path)}`,
      stepPath: step1Path,
      data: expect.objectContaining({ step1Processed: true }),
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_start',
      stepName: `Step 2: ${path.basename(errorStepPath)}`,
      stepPath: errorStepPath,
      data: expect.objectContaining({ step1Processed: true }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:start', {
      workflowName,
      stepName: `Step 2: ${path.basename(errorStepPath)}`,
      stepPath: errorStepPath,
      data: expect.objectContaining({ step1Processed: true }),
    });

    expect(mockStatusCallback).toHaveBeenCalledWith({
      status: 'step_error',
      stepName: `Step 2: ${path.basename(errorStepPath)}`,
      stepPath: errorStepPath,
      error: 'Simulated step error',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('workflow:step:error', {
      workflowName,
      stepName: `Step 2: ${path.basename(errorStepPath)}`,
      stepPath: errorStepPath,
      error: 'Simulated step error',
    });

    // Workflow complete should not be called on error
    expect(mockStatusCallback).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'workflow_complete' }),
    );
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'workflow:complete',
      expect.any(Object),
    );
  });
});
