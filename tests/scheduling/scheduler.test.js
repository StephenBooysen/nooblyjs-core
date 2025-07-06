const path = require('path');
const EventEmitter = require('events');

const workerInstanceMock = {
  start: jest.fn(),
  stop: jest.fn(),
};

jest.doMock('../../src/working', () => {
  return jest.fn(() => workerInstanceMock);
});

const getSchedulerInstance = require('../../src/scheduling');

describe('SchedulerProvider', () => {
  let schedulerInstance;
  let mockEventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    schedulerInstance = getSchedulerInstance('default', {}, mockEventEmitter);
  });

  afterEach(async () => {
    await schedulerInstance.stop();
    getSchedulerInstance._reset();
  });

  it('should be a singleton', () => {
    const anotherInstance = getSchedulerInstance('default', {}, mockEventEmitter);
    expect(schedulerInstance).toBe(anotherInstance);
  });

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