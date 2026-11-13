const path = require('node:path');
const EventEmitter = require('events');

let getWorkerInstance;
let getQueueService;

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined),
  })),
  parentPort: {
    on: jest.fn(),
    postMessage: jest.fn(),
  },
}));

describe('WorkerProvider', () => {
  let workerInstance;
  let MockWorker;
  let mockEventEmitter;
  let mockQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    // Import the queue service
    if (!getQueueService) {
      getQueueService = require('../../../src/queueing');
    }
    mockQueueService = getQueueService('memory', {}, mockEventEmitter);

    // Import the module (keep using cached version for stability)
    if (!getWorkerInstance) {
      getWorkerInstance = require('../../../src/working');
    }
    workerInstance = getWorkerInstance('default', {
      allowAbsolutePaths: true,
      dependencies: {
        queueing: mockQueueService
      }
    }, mockEventEmitter);
    MockWorker = require('worker_threads').Worker;
  });

  afterEach(async () => {
    if (workerInstance && workerInstance.stop) {
      await workerInstance.stop();
    }
    // Reset the singleton instance for next test
    getWorkerInstance._reset();
  });

  it('should be a singleton', () => {
    const anotherInstance = getWorkerInstance('default', {}, mockEventEmitter);
    expect(workerInstance).toBe(anotherInstance);
  });

  it('should start a worker and execute a script', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    const mockCallback = jest.fn();

    // start() queues the task and returns a taskId
    const taskId = await workerInstance.start(mockScriptPath, {}, mockCallback);
    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');

    // Task should be queued
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:queued', expect.objectContaining({
      taskId,
      scriptPath: mockScriptPath,
    }));

    // Process the queue to trigger worker creation
    await workerInstance.processQueue_();

    expect(MockWorker).toHaveBeenCalledTimes(1);
    const workerMock = MockWorker.mock.results[0].value;
    expect(workerMock.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(workerMock.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(workerMock.on).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(workerMock.postMessage).toHaveBeenCalledWith({
      type: 'start',
      scriptPath: mockScriptPath,
      data: {}
    });

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:start', expect.objectContaining({
      taskId,
      scriptPath: mockScriptPath,
      data: {},
    }));
  });

  it('should report status updates from the worker', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    const mockCallback = jest.fn();

    const taskId = await workerInstance.start(mockScriptPath, {}, mockCallback);
    await workerInstance.processQueue_();

    const workerMock = MockWorker.mock.results[0].value;
    const messageHandler = workerMock.on.mock.calls.find(c => c[0] === 'message')[1];

    // Simulate worker sending a running status
    messageHandler({ type: 'status', status: 'running' });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:status', {
      taskId,
      status: 'running',
      data: undefined,
    });

    // Simulate worker sending a completed status
    await messageHandler({ type: 'status', status: 'completed', data: 'task done' });
    expect(mockCallback).toHaveBeenCalledWith('completed', 'task done');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:status', {
      taskId,
      status: 'completed',
      data: 'task done',
    });

    // Worker should be cleaned up after completion
    expect(workerMock.terminate).toHaveBeenCalledTimes(1);
  });

  it('should handle worker errors', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    const mockCallback = jest.fn();

    const taskId = await workerInstance.start(mockScriptPath, {}, mockCallback);
    await workerInstance.processQueue_();

    const workerMock = MockWorker.mock.results[0].value;
    const errorHandler = workerMock.on.mock.calls.find(c => c[0] === 'error')[1];

    const error = new Error('Worker failed');
    await errorHandler(error);

    expect(mockCallback).toHaveBeenCalledWith('error', error.message);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:error', expect.objectContaining({
      taskId,
      error: error.message,
    }));
  });

  it('should handle worker exit with non-zero code', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    const mockCallback = jest.fn();

    const taskId = await workerInstance.start(mockScriptPath, {}, mockCallback);
    await workerInstance.processQueue_();

    const workerMock = MockWorker.mock.results[0].value;
    const exitHandler = workerMock.on.mock.calls.find(c => c[0] === 'exit')[1];

    await exitHandler(1); // Simulate non-zero exit code

    expect(mockCallback).toHaveBeenCalledWith('error', 'Worker exited with code 1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:exit:error', expect.objectContaining({
      taskId,
      code: 1,
    }));
  });

  it('should not start if worker manager is stopped', async () => {
    await workerInstance.stop();

    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');

    await expect(workerInstance.start(mockScriptPath, {})).rejects.toThrow('Worker manager is stopped');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:start:error', {
      scriptPath: mockScriptPath,
      error: 'Worker manager is stopped',
    });
  });

  it('should stop the worker manager and terminate active workers', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    await workerInstance.start(mockScriptPath, {});
    await workerInstance.processQueue_();

    expect(MockWorker).toHaveBeenCalledTimes(1);

    mockEventEmitter.emit.mockClear();
    await workerInstance.stop();

    const workerMock = MockWorker.mock.results[0].value;
    expect(workerMock.terminate).toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:manager:stopping', expect.any(Object));
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:manager:stopped');

    const status = await workerInstance.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.activeWorkers).toBe(0);
  });
});
