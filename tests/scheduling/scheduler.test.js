/**
 * @fileoverview Unit tests for the SchedulerProvider.
 */

const getSchedulerInstance = require('../../src/scheduling');
const getWorkerInstance = require('../../src/working');
const path = require('path');
const EventEmitter = require('events');

jest.useFakeTimers();

describe('SchedulerProvider', () => {
  let schedulerInstance;
  let workerInstanceMock;
  let mockEventEmitter;

  beforeEach(() => {
    jest.resetModules();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    schedulerInstance = getSchedulerInstance(mockEventEmitter);
    const worker = getWorkerInstance(mockEventEmitter);
    workerInstanceMock = {
      start: jest.spyOn(worker, 'start').mockImplementation(() => {}),
      stop: jest.spyOn(worker, 'stop').mockImplementation(() => {}),
      getStatus: jest.spyOn(worker, 'getStatus').mockImplementation(() => 'idle'),
    };
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

    jest.advanceTimersByTime(mockInterval * 1000);
    expect(workerInstanceMock.start).toHaveBeenCalledTimes(2); // Initial call + 1 interval
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
    workerInstanceMock.start.mock.calls[0][1]('completed', 'initial run');
    expect(mockCallback).toHaveBeenCalledWith('completed', 'initial run');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:taskExecuted', {scriptPath: mockScriptPath, status: 'completed', data: 'initial run'});

    mockEventEmitter.emit.mockClear();
    jest.advanceTimersByTime(mockInterval * 1000);

    // Simulate worker completion for the interval call
    workerInstanceMock.start.mock.calls[1][1]('completed', 'interval run');
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
