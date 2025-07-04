const createMeasuringService = require('../../src/measuring');
const EventEmitter = require('events');

describe('MeasuringService', () => {
  let measuringService;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    measuringService = createMeasuringService('default', {}, mockEventEmitter);
  });

  it('should add a measure to a metric', () => {
    measuringService.add('Orders per day', 10);
    expect(measuringService.metrics.get('Orders per day').length).toBe(1);
    expect(measuringService.metrics.get('Orders per day')[0].value).toBe(10);
    expect(
      measuringService.metrics.get('Orders per day')[0].timestamp,
    ).toBeInstanceOf(Date);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:add', {
      metricName: 'Orders per day',
      measure: expect.any(Object),
    });
  });

  it('should list measures within a specified period', () => {
    const metricName = 'Orders per day';
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    measuringService.add(metricName, 5); // Yesterday
    measuringService.metrics.get(metricName)[0].timestamp = yesterday;

    measuringService.add(metricName, 10); // Today
    measuringService.metrics.get(metricName)[1].timestamp = now;

    measuringService.add(metricName, 15); // Tomorrow
    measuringService.metrics.get(metricName)[2].timestamp = tomorrow;

    mockEventEmitter.emit.mockClear();
    const measures = measuringService.list(metricName, yesterday, now);
    expect(measures.length).toBe(2);
    expect(measures[0].value).toBe(5);
    expect(measures[1].value).toBe(10);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:list', {
      metricName,
      startDate: yesterday,
      endDate: now,
      measures,
    });
  });

  it('should calculate the total of measures within a specified period', () => {
    const metricName = 'Orders per day';
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    measuringService.add(metricName, 5); // Yesterday
    measuringService.metrics.get(metricName)[0].timestamp = yesterday;

    measuringService.add(metricName, 10); // Today
    measuringService.metrics.get(metricName)[1].timestamp = now;

    measuringService.add(metricName, 15); // Tomorrow
    measuringService.metrics.get(metricName)[2].timestamp = tomorrow;

    mockEventEmitter.emit.mockClear();
    const total = measuringService.total(metricName, yesterday, now);
    expect(total).toBe(15); // 5 (yesterday) + 10 (today)
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:total', {
      metricName,
      startDate: yesterday,
      endDate: now,
      total,
    });
  });

  it('should calculate the average of measures within a specified period', () => {
    const metricName = 'Orders per day';
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    measuringService.add(metricName, 5); // Yesterday
    measuringService.metrics.get(metricName)[0].timestamp = yesterday;

    measuringService.add(metricName, 10); // Today
    measuringService.metrics.get(metricName)[1].timestamp = now;

    measuringService.add(metricName, 15); // Tomorrow
    measuringService.metrics.get(metricName)[2].timestamp = tomorrow;

    mockEventEmitter.emit.mockClear();
    const average = measuringService.average(metricName, yesterday, now);
    expect(average).toBe(7.5); // (5 + 10) / 2
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:average', {
      metricName,
      startDate: yesterday,
      endDate: now,
      average,
    });
  });

  it('should return 0 for total if no measures are found in the period', () => {
    const metricName = 'Orders per day';
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    measuringService.add(metricName, 10);
    measuringService.metrics.get(metricName)[0].timestamp = twoDaysAgo;

    mockEventEmitter.emit.mockClear();
    const total = measuringService.total(metricName, now, now);
    expect(total).toBe(0);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:total', {
      metricName,
      startDate: now,
      endDate: now,
      total: 0,
    });
  });

  it('should return 0 for average if no measures are found in the period', () => {
    const metricName = 'Orders per day';
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    measuringService.add(metricName, 10);
    measuringService.metrics.get(metricName)[0].timestamp = twoDaysAgo;

    mockEventEmitter.emit.mockClear();
    const average = measuringService.average(metricName, now, now);
    expect(average).toBe(0);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:average', {
      metricName,
      startDate: now,
      endDate: now,
      average: 0,
    });
  });

  it('should handle non-existent metrics gracefully', () => {
    const now = new Date();
    mockEventEmitter.emit.mockClear();
    const total = measuringService.total('NonExistentMetric', now, now);
    const average = measuringService.average('NonExistentMetric', now, now);
    const list = measuringService.list('NonExistentMetric', now, now);

    expect(total).toBe(0);
    expect(average).toBe(0);
    expect(list).toEqual([]);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:total', {
      metricName: 'NonExistentMetric',
      startDate: now,
      endDate: now,
      total: 0,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:average', {
      metricName: 'NonExistentMetric',
      startDate: now,
      endDate: now,
      average: 0,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('measuring:list', {
      metricName: 'NonExistentMetric',
      startDate: now,
      endDate: now,
      measures: [],
    });
  });
});
