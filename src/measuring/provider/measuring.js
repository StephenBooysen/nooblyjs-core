/**
 * @fileoverview Measuring service for capturing and aggregating metrics
 * with time-based filtering and statistical calculations.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements a measuring service for metrics collection.
 * Provides methods for adding measures and calculating statistics over time periods.
 * @class
 */
class MeasuringService {
  /**
   * Initializes the measuring service with metric storage.
   * @param {Object=} options Configuration options for the service.
   * @param {EventEmitter=} eventEmitter Optional event emitter for measuring events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Map<string, Array<{value: number, timestamp: Date}>>} */
    this.metrics = new Map(); // Stores metrics: Map<metricName, Array<{value: number, timestamp: Date}>>
    /** @private @const {Object} */
    this.options = options || {};
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a measure to a specified metric with current timestamp.
   * @param {string} metricName The name of the metric.
   * @param {number} value The value of the measure.
   * @return {void}
   */
  add(metricName, value) {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }
    const measure = { value, timestamp: new Date() };
    this.metrics.get(metricName).push(measure);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('measuring:add', { metricName, measure });
  }

  /**
   * Filters measures within a specified date range.
   * @param {string} metricName The name of the metric.
   * @param {Date} startDate The start date of the period (inclusive).
   * @param {Date} endDate The end date of the period (inclusive).
   * @return {Array<{value: number, timestamp: Date}>} An array of measures within the period.
   * @private
   */
  _filterMeasuresByPeriod(metricName, startDate, endDate) {
    // Debug logging removed for production
    const measures = this.metrics.get(metricName);
    if (!measures) {
      return [];
    }
    return measures.filter((measure) => {
      const timestamp = measure.timestamp.getTime();
      return timestamp >= startDate.getTime() && timestamp <= endDate.getTime();
    });
  }

  /**
   * Returns all measures for a given metric within a specified date range.
   * @param {string} metricName The name of the metric.
   * @param {Date} startDate The start date of the period (inclusive).
   * @param {Date} endDate The end date of the period (inclusive).
   * @return {Array<{value: number, timestamp: Date}>} An array of measures.
   */
  list(metricName, startDate, endDate) {
    const measures = this._filterMeasuresByPeriod(
      metricName,
      startDate,
      endDate,
    );
    if (this.eventEmitter_)
      this.eventEmitter_.emit('measuring:list', {
        metricName,
        startDate,
        endDate,
        measures,
      });
    return measures;
  }

  /**
   * Calculates the total of all measures for a given metric within a specified date range.
   * @param {string} metricName The name of the metric.
   * @param {Date} startDate The start date of the period (inclusive).
   * @param {Date} endDate The end date of the period (inclusive).
   * @return {number} The total sum of measures.
   */
  total(metricName, startDate, endDate) {
    const measures = this._filterMeasuresByPeriod(
      metricName,
      startDate,
      endDate,
    );
    const total = measures.reduce((sum, measure) => sum + measure.value, 0);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('measuring:total', {
        metricName,
        startDate,
        endDate,
        total,
      });
    return total;
  }

  /**
   * Calculates the average of all measures for a given metric within a specified date range.
   * @param {string} metricName The name of the metric.
   * @param {Date} startDate The start date of the period (inclusive).
   * @param {Date} endDate The end date of the period (inclusive).
   * @return {number} The average of measures.
   */
  average(metricName, startDate, endDate) {
    const measures = this._filterMeasuresByPeriod(
      metricName,
      startDate,
      endDate,
    );
    if (measures.length === 0) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:average', {
          metricName,
          startDate,
          endDate,
          average: 0,
        });
      return 0;
    }
    const sum = this.total(metricName, startDate, endDate);
    const average = sum / measures.length;
    if (this.eventEmitter_)
      this.eventEmitter_.emit('measuring:average', {
        metricName,
        startDate,
        endDate,
        average,
      });
    return average;
  }
}

module.exports = MeasuringService;
