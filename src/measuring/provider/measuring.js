/**
 * @fileoverview Measuring service for capturing and aggregating metrics.
 */

class MeasuringService {
  constructor(options, eventEmitter) {
    this.metrics = new Map(); // Stores metrics: Map<metricName, Array<{value: number, timestamp: Date}>>
    this.options = options || {};
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a measure to a specified metric.
   * @param {string} metricName - The name of the metric.
   * @param {number} value - The value of the measure.
   */
  async add(metricName, value) {
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
   * @param {string} metricName - The name of the metric.
   * @param {Date} startDate - The start date of the period (inclusive).
   * @param {Date} endDate - The end date of the period (inclusive).
   * @returns {Array<{value: number, timestamp: Date}>} - An array of measures within the period.
   */
   _filterMeasuresByPeriod(metricName, startDate, endDate) {
    console.log(startDate);
    console.log(endDate);   
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
   * @param {string} metricName - The name of the metric.
   * @param {Date} startDate - The start date of the period (inclusive).
   * @param {Date} endDate - The end date of the period (inclusive).
   * @returns {Array<{value: number, timestamp: Date}>} - An array of measures.
   */
  async list(metricName, startDate, endDate) {
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
   * @param {string} metricName - The name of the metric.
   * @param {Date} startDate - The start date of the period (inclusive).
   * @param {Date} endDate - The end date of the period (inclusive).
   * @returns {number} - The total sum of measures.
   */
  async total(metricName, startDate, endDate) {
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
   * @param {string} metricName - The name of the metric.
   * @param {Date} startDate - The start date of the period (inclusive).
   * @param {Date} endDate - The end date of the period (inclusive).
   * @returns {number} - The average of measures.
   */
  async average(metricName, startDate, endDate) {
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