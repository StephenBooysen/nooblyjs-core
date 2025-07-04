/**
 * @fileoverview Unit tests for the SchedulerProvider.
 */

const getSchedulerInstance = require('../../src/scheduling');
const getWorkerInstance = require('../../src/working');
const path = require('path');
const EventEmitter = require('events');

jest.useFakeTimers();

  beforeEach(() => {
    jest.resetModules();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    getSchedulerInstance.reset(); // Reset the singleton instance

    jest.mock('../../src/working', () => {
  mockWorker = {
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => 'idle'),
  };
  return jest.fn(() => mockWorker);
});
    const getWorkerInstance = require('../../src/working');
    workerInstanceMock = getWorkerInstance();

    // Reset the mock implementations for each test
    mockWorker.start.mockClear();
    mockWorker.stop.mockClear();
    mockWorker.getStatus.mockClear();

    schedulerInstance = getSchedulerInstance('default', {}, mockEventEmitter);

    // Store the callback to be invoked manually by the test
    workerInstanceMock.start.mockImplementation((scriptPath, callback) => {
      workerInstanceMock.lastCallback = callback;
    });
  });

  afterEach(() => {
    schedulerInstance.stop();
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  it('should be a singleton', () => {
    const anotherInstance = getSchedulerInstance(mockEventEmitter);
    expect(schedulerInstance).toBe(anotherInstance);
  });

  it('should start and stop the scheduler', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1;
    const mockCallback = jest.fn();

    expect(schedulerInstance.isRunning()).toBe(false);
    schedulerInstance.start(mockScriptPath, mockInterval, mockCallback);
    expect(schedulerInstance.isRunning()).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:started', {scriptPath: mockScriptPath, intervalSeconds: mockInterval});

    // Manually trigger the first worker completion
    workerInstanceMock.lastCallback('completed', 'initial run');

    jest.advanceTimersByTime(mockInterval * 1000);
    expect(workerInstanceMock.start).toHaveBeenCalledTimes(2); // Initial call + 1 interval
    // Manually trigger the second worker completion
    workerInstanceMock.lastCallback('completed', 'interval run');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:taskExecuted', {scriptPath: mockScriptPath, status: expect.any(String), data: expect.any(String)});

    mockEventEmitter.emit.mockClear();
    schedulerInstance.stop();
    expect(schedulerInstance.isRunning()).toBe(false);
    expect(workerInstanceMock.stop).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:stopped');
  });

  it('should call the execution callback on each execution', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1;
    const mockCallback = jest.fn();

    schedulerInstance.start(mockScriptPath, mockInterval, mockCallback);

    // Simulate worker completion for the initial call
    workerInstanceMock.lastCallback('completed', 'initial run');
    expect(mockCallback).toHaveBeenCalledWith('completed', 'initial run');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:taskExecuted', {scriptPath: mockScriptPath, status: 'completed', data: 'initial run'});

    mockEventEmitter.emit.mockClear();
    jest.advanceTimersByTime(mockInterval * 1000);

    // Simulate worker completion for the interval call
    workerInstanceMock.lastCallback('completed', 'interval run');
    expect(mockCallback).toHaveBeenCalledWith('completed', 'interval run');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:taskExecuted', {scriptPath: mockScriptPath, status: 'completed', data: 'interval run'});

    expect(mockCallback).toHaveBeenCalledTimes(2);
  });

  it('should not start if already running', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1;

    schedulerInstance.start(mockScriptPath, mockInterval);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:started', {scriptPath: mockScriptPath, intervalSeconds: mockInterval});
    mockEventEmitter.emit.mockClear();
    schedulerInstance.start(mockScriptPath, mockInterval); // Try to start again

    expect(workerInstanceMock.start).toHaveBeenCalledTimes(1); // Only initial call
    expect(schedulerInstance.isRunning()).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:start:error', {scriptPath: mockScriptPath, error: 'Scheduler already running.'});
  });
  });
