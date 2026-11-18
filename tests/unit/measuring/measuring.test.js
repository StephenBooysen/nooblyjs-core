/**
 * @fileoverview Unit tests for the measuring service functionality.
 * 
 * This test suite covers the measuring service provider, testing metric
 * collection, aggregation operations (total, average), and time-based
 * filtering of measurements. Tests verify proper event emission and
 * data handling for performance metrics.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createMeasuringService = require('../../../src/measuring');
const EventEmitter = require('events');

/**
 * Test suite for measuring service operations.
 * 
 * Tests the measuring service functionality including metric collection,
 * data aggregation (total, average), time-based filtering, and error handling.
 */
describe('MeasuringService', () => {
  /** @type {Object} Measuring service instance for testing */
  let measuringService;
  /** @type {EventEmitter} Mock event emitter for testing measuring events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh measuring service instance and event emitter spy.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    measuringService = createMeasuringService('default', {}, mockEventEmitter);
  });

  /**
   * Test adding measurements to metrics.
   * 
   * Verifies that measurements can be added to metrics with proper
   * timestamp generation and event emission.
   */
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

  /**
   * Test listing measurements within a time period.
   * 
   * Verifies that measurements can be filtered by date range and
   * returns only measurements within the specified period.
   */
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

  /**
   * Test calculating total of measurements within a time period.
   * 
   * Verifies that the sum of all measurements within a date range
   * is calculated correctly and proper events are emitted.
   */
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

  /**
   * Test calculating average of measurements within a time period.
   * 
   * Verifies that the average of all measurements within a date range
   * is calculated correctly and proper events are emitted.
   */
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

  /**
   * Test total calculation with no measurements in period.
   * 
   * Verifies that total returns 0 when no measurements exist
   * within the specified time period.
   */
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

  /**
   * Test average calculation with no measurements in period.
   * 
   * Verifies that average returns 0 when no measurements exist
   * within the specified time period.
   */
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

  /**
   * Test handling of non-existent metrics.
   * 
   * Verifies that operations on non-existent metrics return appropriate
   * default values and emit proper events without throwing errors.
   */
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
