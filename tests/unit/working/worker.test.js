const path = require('path');
const EventEmitter = require('events');

let getWorkerInstance;

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    // Import the module (keep using cached version for stability)
    if (!getWorkerInstance) {
      getWorkerInstance = require('../../../src/working');
    }
    workerInstance = getWorkerInstance('default', {}, mockEventEmitter);
    MockWorker = require('worker_threads').Worker;
  });

  afterEach(() => {
    if (workerInstance && workerInstance.stop) {
      workerInstance.stop(); // Ensure worker is stopped after each test
    }
  });

  it('should be a singleton', () => {
    const anotherInstance = getWorkerInstance('default', {}, mockEventEmitter);
    expect(workerInstance).toBe(anotherInstance);
  });

  it('should start a worker and execute a script', async () => {
    const mockScriptPath = path.resolve(
      __dirname,
      '../../src/working/exampleTask.js',
    );
    const mockCallback = jest.fn();

    workerInstance.start(mockScriptPath, {}, mockCallback);

    expect(MockWorker).toHaveBeenCalledTimes(1);
    const workerInstanceMock = MockWorker.mock.results[0].value;
    expect(workerInstanceMock.on).toHaveBeenCalledWith(
      'message',
      expect.any(Function),
    );
    expect(workerInstanceMock.on).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
    expect(workerInstanceMock.on).toHaveBeenCalledWith(
      'exit',
      expect.any(Function),
    );
    expect(workerInstanceMock.postMessage).toHaveBeenCalledWith({
      type: 'start',
      scriptPath: mockScriptPath,
    });
    expect(await workerInstance.getStatus()).toBe('idle'); // Status is updated by message from worker
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:start', {
      scriptPath: mockScriptPath,
    });
  });

  it('should report status updates from the worker', async () => {
    const mockScriptPath = path.resolve(
      __dirname,
      '../../src/working/exampleTask.js',
    );
    const mockCallback = jest.fn();
    workerInstance.start(mockScriptPath, {}, mockCallback);

    const workerInstanceMock = MockWorker.mock.results[0].value;
    const messageHandler = workerInstanceMock.on.mock.calls[0][1];

    // Simulate worker sending a running status
    messageHandler({ type: 'status', status: 'running' });
    expect(await workerInstance.getStatus()).toBe('running');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:status', {
      status: 'running',
      data: undefined,
    });

    mockEventEmitter.emit.mockClear();
    // Simulate worker sending a completed status
    messageHandler({ type: 'status', status: 'completed', data: 'task done' });
    expect(await workerInstance.getStatus()).toBe('idle'); // Should be idle after stop
    expect(mockCallback).toHaveBeenCalledWith('completed', 'task done');
    expect(workerInstanceMock.terminate).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:status', {
      status: 'completed',
      data: 'task done',
    });
  });

  it('should handle worker errors', async () => {
    const mockScriptPath = path.resolve(
      __dirname,
      '../../src/working/exampleTask.js',
    );
    const mockCallback = jest.fn();
    workerInstance.start(mockScriptPath, {}, mockCallback);

    const workerInstanceMock = MockWorker.mock.results[0].value;
    const errorHandler = workerInstanceMock.on.mock.calls[1][1];

    const error = new Error('Worker failed');
    errorHandler(error);

    expect(await workerInstance.getStatus()).toBe('idle'); // Should be idle after stop
    expect(mockCallback).toHaveBeenCalledWith('error', error.message);
    expect(workerInstanceMock.terminate).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:error', {
      error: error.message,
    });
  });

  it('should handle worker exit with non-zero code', async () => {
    const mockScriptPath = path.resolve(
      __dirname,
      '../../src/working/exampleTask.js',
    );
    const mockCallback = jest.fn();
    workerInstance.start(mockScriptPath, {}, mockCallback);

    const workerInstanceMock = MockWorker.mock.results[0].value;
    const exitHandler = workerInstanceMock.on.mock.calls[2][1];

    exitHandler(1); // Simulate non-zero exit code

    expect(await workerInstance.getStatus()).toBe('error'); // Should be error after non-zero exit
    expect(mockCallback).toHaveBeenCalledWith(
      'error',
      'Worker exited with code 1',
    );
    expect(workerInstanceMock.terminate).toHaveBeenCalledTimes(0); // Terminate is not called on exit
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:exit:error', {
      code: 1,
    });
  });

  it('should not start if worker is already running', () => {
    const mockScriptPath = path.resolve(
      __dirname,
      '../../src/working/exampleTask.js',
    );
    workerInstance.start(mockScriptPath, {});
    mockEventEmitter.emit.mockClear();
    workerInstance.start(mockScriptPath, {}); // Try to start again

    expect(MockWorker).toHaveBeenCalledTimes(1); // Should only be called once
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:start:error', {
      scriptPath: mockScriptPath,
      error: 'Worker already running.',
    });
  });

  it('should stop the worker', async () => {
    const mockScriptPath = path.resolve(__dirname, './exampleTask.js');
    workerInstance.start(mockScriptPath, {});

    const workerInstanceMock = MockWorker.mock.results[0].value;
    mockEventEmitter.emit.mockClear();
    workerInstance.stop();

    expect(workerInstanceMock.terminate).toHaveBeenCalledTimes(1);
    expect(await workerInstance.getStatus()).toBe('idle');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('worker:stop');
  });
});
