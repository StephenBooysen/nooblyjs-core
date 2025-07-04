const path = require('path');
const getSchedulerInstance = require('../../src/scheduling');
const EventEmitter = require('events');

jest.mock('../../src/working', () => {
  return jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => 'idle'),
  }));
});

describe('SchedulerProvider', () => {
  let schedulerInstance;
  let mockEventEmitter;
  let workerInstanceMock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    schedulerInstance = getSchedulerInstance('default', {'express-app': {}}, mockEventEmitter);
    
    const WorkerMock = require('../../src/working');
    workerInstanceMock = WorkerMock.mock.instances[0];
  });

  it('should be a singleton', () => {
    const anotherInstance = getSchedulerInstance('default', {'express-app': {}}, mockEventEmitter);
    expect(schedulerInstance).toBe(anotherInstance);
  });

  it('should start a scheduled task', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1; // 1 second interval

    schedulerInstance.start(mockScriptPath, mockInterval);

    expect(workerInstanceMock.start).toHaveBeenCalledWith(mockScriptPath, expect.any(Function));
    expect(schedulerInstance.isRunning()).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:started', {scriptPath: mockScriptPath, intervalSeconds: mockInterval});
  });

  it('should stop a scheduled task', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 5;

    schedulerInstance.start(mockScriptPath, mockInterval);
    expect(schedulerInstance.isRunning()).toBe(true);

    mockEventEmitter.emit.mockClear();
    schedulerInstance.stop();

    expect(workerInstanceMock.stop).toHaveBeenCalledTimes(1);
    expect(schedulerInstance.isRunning()).toBe(false);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:stopped');
  });

  it('should get the current status', () => {
    expect(schedulerInstance.getStatus()).toBe('idle');
  });

  it('should handle task completion and restart after interval', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1;

    schedulerInstance.start(mockScriptPath, mockInterval);

    // Simulate task completion
    const completionCallback = workerInstanceMock.start.mock.calls[0][1];
    completionCallback('completed', 'Task completed');

    expect(workerInstanceMock.start).toHaveBeenCalledTimes(1); // Initially called once
    expect(schedulerInstance.isRunning()).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:task:completed', {data: 'Task completed'});

    // After the interval, the task should be restarted automatically
    // This is handled by setInterval, which we can't easily test directly in this setup
  });

  it('should handle task errors and continue scheduling', () => {
    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 1;

    schedulerInstance.start(mockScriptPath, mockInterval);

    // Simulate task error
    const completionCallback = workerInstanceMock.start.mock.calls[0][1];
    completionCallback('error', 'Task failed');

    expect(workerInstanceMock.start).toHaveBeenCalledTimes(1); // Initially called once
    expect(schedulerInstance.isRunning()).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('scheduler:task:error', {error: 'Task failed'});

    // After the interval, the task should be restarted automatically even after an error
  });

  it('should be able to get the interval', () => {
    expect(schedulerInstance.getInterval()).toBe(null); // No interval set initially

    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 5;

    schedulerInstance.start(mockScriptPath, mockInterval);
    expect(schedulerInstance.getInterval()).toBe(mockInterval);
  });

  it('should be able to get the script path', () => {
    expect(schedulerInstance.getScriptPath()).toBe(null); // No script path set initially

    const mockScriptPath = path.resolve(__dirname, '../../src/scheduling/exampleScheduledTask.js');
    const mockInterval = 5;

    schedulerInstance.start(mockScriptPath, mockInterval);
    expect(schedulerInstance.getScriptPath()).toBe(mockScriptPath);
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