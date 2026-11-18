/**
 * @fileoverview Queueing Analytics Module
 * Captures and stores queue activity metrics for analytics purposes.
 * Tracks enqueue/dequeue operations and provides statistics about queue usage.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

/**
 * A class that captures and stores queue activity metrics for analytics.
 * Maintains statistics about queue operations and activity over time.
 * @class
 */
class QueueAnalytics {
  /**
   * Initializes the queue analytics module.
   * @param {EventEmitter} eventEmitter - Event emitter to listen for queue events.
   * @param {string} instanceName - The instance name this analytics module tracks (default: 'default').
   */
  constructor(eventEmitter, instanceName = 'default') {
    /** @private @const {number} Maximum number of activity entries to store per queue */
    this.MAX_ACTIVITY_ENTRIES_ = 1000;

    /** @private {Map<string, Object>} Queue statistics by queue name */
    this.queueStats_ = new Map();

    /** @private {Map<string, Array<Object>>} Activity timeline by queue name */
    this.queueActivity_ = new Map();

    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    /** @private @const {string} Instance name for this analytics module */
    this.instanceName_ = instanceName;

    // Set up event listeners for queue operations
    this.initializeListeners_();
  }

  /**
   * Initializes event listeners for queue operations.
   * @private
   */
  initializeListeners_() {
    if (!this.eventEmitter_) {
      return;
    }

    const enqueueEventName = `queue:enqueue:${this.instanceName_}`;
    const dequeueEventName = `queue:dequeue:${this.instanceName_}`;
    const purgeEventName = `queue:purge:${this.instanceName_}`;

    // Store named listener references for cleanup in destroy()
    this.listeners_ = {
      [enqueueEventName]: (data) => {
        this.recordActivity_(data.queueName, 'enqueue', data.item);
      },
      [dequeueEventName]: (data) => {
        this.recordActivity_(data.queueName, 'dequeue', data.item);
      },
      [purgeEventName]: (data) => {
        this.recordActivity_(data.queueName, 'purge', null);
      }
    };

    // Listen for queue events
    this.eventEmitter_.on(enqueueEventName, this.listeners_[enqueueEventName]);
    this.eventEmitter_.on(dequeueEventName, this.listeners_[dequeueEventName]);
    this.eventEmitter_.on(purgeEventName, this.listeners_[purgeEventName]);
  }

  /**
   * Removes all event listeners and clears stored analytics data.
   * Should be called when the analytics module is no longer needed to prevent memory leaks.
   * @return {void}
   */
  destroy() {
    if (this.eventEmitter_ && this.listeners_) {
      for (const [eventName, listener] of Object.entries(this.listeners_)) {
        this.eventEmitter_.removeListener(eventName, listener);
      }
      this.listeners_ = null;
    }
    this.queueStats_.clear();
    this.queueActivity_.clear();
  }

  /**
   * Records a queue activity event.
   * @private
   * @param {string} queueName - The name of the queue.
   * @param {string} operation - The operation type (enqueue, dequeue, purge).
   * @param {*} item - The item involved in the operation.
   */
  recordActivity_(queueName, operation, item) {
    // Initialize stats for this queue if it doesn't exist
    if (!this.queueStats_.has(queueName)) {
      this.queueStats_.set(queueName, {
        enqueueCount: 0,
        dequeueCount: 0,
        purgeCount: 0,
        totalMessages: 0,
        firstActivity: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      });
    }

    // Initialize activity array for this queue if it doesn't exist
    if (!this.queueActivity_.has(queueName)) {
      this.queueActivity_.set(queueName, []);
    }

    // Update statistics
    const stats = this.queueStats_.get(queueName);
    const activity = this.queueActivity_.get(queueName);

    if (operation === 'enqueue') {
      stats.enqueueCount++;
      stats.totalMessages++;
    } else if (operation === 'dequeue') {
      stats.dequeueCount++;
    } else if (operation === 'purge') {
      stats.purgeCount++;
    }

    stats.lastActivity = new Date().toISOString();

    // Record activity entry
    const activityEntry = {
      operation: operation,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now()
    };

    // Add to the beginning for newest-first ordering
    activity.unshift(activityEntry);

    // Maintain max size by removing oldest entries
    if (activity.length > this.MAX_ACTIVITY_ENTRIES_) {
      activity.pop();
    }
  }

  /**
   * Gets statistics for all queues.
   * @return {Object} Statistics object with queue counts and percentages.
   */
  getStats() {
    const queues = Array.from(this.queueStats_.keys());
    const stats = {};

    queues.forEach(queueName => {
      stats[queueName] = { ...this.queueStats_.get(queueName) };
    });

    return {
      totalQueues: queues.length,
      queues: stats
    };
  }

  /**
   * Gets statistics for a specific queue.
   * @param {string} queueName - The name of the queue.
   * @return {Object|null} Statistics for the queue or null if not found.
   */
  getQueueStats(queueName) {
    if (!this.queueStats_.has(queueName)) {
      return null;
    }

    return { ...this.queueStats_.get(queueName) };
  }

  /**
   * Gets the distribution of messages across all queues for pie chart.
   * @return {Object} Distribution data with labels and values.
   */
  getDistribution() {
    const labels = [];
    const data = [];

    this.queueStats_.forEach((stats, queueName) => {
      labels.push(queueName);
      data.push(stats.totalMessages);
    });

    return {
      labels: labels,
      data: data
    };
  }

  /**
   * Gets the top N queues by total activity (enqueue + dequeue operations).
   * @param {number} limit - Number of top queues to return.
   * @return {Array} Array of queue statistics sorted by activity.
   */
  getTopQueues(limit = 10) {
    const queues = Array.from(this.queueStats_.entries()).map(([name, stats]) => ({
      name: name,
      totalActivity: stats.enqueueCount + stats.dequeueCount,
      enqueueCount: stats.enqueueCount,
      dequeueCount: stats.dequeueCount,
      totalMessages: stats.totalMessages
    }));

    // Sort by total activity descending
    queues.sort((a, b) => b.totalActivity - a.totalActivity);

    return queues.slice(0, limit);
  }

  /**
   * Gets timeline data showing queue activity over time for top queues.
   * @param {number} topN - Number of top queues to include in timeline.
   * @return {Object} Timeline object with time labels and datasets for each queue.
   */
  getTimeline(topN = 10) {
    const topQueues = this.getTopQueues(topN);

    if (topQueues.length === 0) {
      return {
        labels: [],
        datasets: []
      };
    }

    // Create a map to store counts per minute per queue
    const timeMap = new Map();

    // Process activity for each top queue
    topQueues.forEach(queueInfo => {
      const queueName = queueInfo.name;
      const activity = this.queueActivity_.get(queueName) || [];

      activity.forEach(entry => {
        const entryTime = new Date(entry.timestamp);
        // Round down to the nearest minute
        const minuteKey = new Date(entryTime.getFullYear(), entryTime.getMonth(), entryTime.getDate(),
                                   entryTime.getHours(), entryTime.getMinutes(), 0, 0).getTime();

        if (!timeMap.has(minuteKey)) {
          const queueCounts = {};
          topQueues.forEach(q => {
            queueCounts[q.name] = 0;
          });
          timeMap.set(minuteKey, queueCounts);
        }

        const counts = timeMap.get(minuteKey);
        counts[queueName]++;
      });
    });

    // Sort time keys and create labels
    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
    const labels = sortedTimes.map(time => {
      const date = new Date(time);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    });

    // Create datasets for each queue
    const datasets = topQueues.map(queueInfo => ({
      name: queueInfo.name,
      data: sortedTimes.map(time => timeMap.get(time)[queueInfo.name] || 0)
    }));

    return {
      labels: labels,
      datasets: datasets
    };
  }

  /**
   * Gets a list of all queues with their current message counts.
   * This requires the queue service instance to get current sizes.
   * @param {Object} queueService - The queue service instance.
   * @param {number} limit - Maximum number of queues to return.
   * @return {Promise<Array>} Array of queue information with current sizes.
   */
  async getQueueList(queueService, limit = 100) {
    if (!queueService) {
      // Return cached data if no queue service provided
      const queues = this.getTopQueues(limit);
      return queues.map(q => ({
        name: q.name,
        currentSize: 0, // Can't get current size without queue service
        totalEnqueued: q.enqueueCount,
        totalDequeued: q.dequeueCount,
        totalMessages: q.totalMessages,
        stats: this.getQueueStats(q.name)
      }));
    }

    try {
      // Get all queue names from the service
      const queueNames = await queueService.listQueues();

      // Get current size and stats for each queue
      const queueInfoPromises = queueNames.slice(0, limit).map(async (queueName) => {
        const currentSize = await queueService.size(queueName);
        const stats = this.getQueueStats(queueName) || {
          enqueueCount: 0,
          dequeueCount: 0,
          totalMessages: 0
        };

        return {
          name: queueName,
          currentSize: currentSize,
          totalEnqueued: stats.enqueueCount,
          totalDequeued: stats.dequeueCount,
          totalMessages: stats.totalMessages,
          stats: stats
        };
      });

      const queueList = await Promise.all(queueInfoPromises);

      // Sort by current size descending
      queueList.sort((a, b) => b.currentSize - a.currentSize);

      return queueList;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('queue:analytics:error', { operation: 'getQueueList', error: error.message });
      }
      return [];
    }
  }

  /**
   * Clears all stored analytics data.
   * @return {void}
   */
  clear() {
    this.queueStats_.clear();
    this.queueActivity_.clear();
  }

  /**
   * Gets the total count of tracked queues.
   * @return {number} The number of queues being tracked.
   */
  getQueueCount() {
    return this.queueStats_.size;
  }
}

module.exports = QueueAnalytics;
