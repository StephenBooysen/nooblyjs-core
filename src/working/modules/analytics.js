/**
 * @fileoverview Working Analytics Module
 * Captures and stores analytics about worker tasks including run counts, error counts,
 * completion counts, duration, and last run timestamps for each unique task.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

/**
 * A class that captures and stores worker task analytics.
 * Tracks per-task statistics and overall totals.
 * @class
 */
class WorkingAnalytics {

  /**
   * Initializes the working analytics module.
   * @param {EventEmitter} eventEmitter - Event emitter to listen for worker events.
   */
  constructor(eventEmitter) {
    /** @private {Map} Task analytics by script path */
    this.taskAnalytics_ = new Map();

    /** @private {Object} Overall totals */
    this.totals_ = {
      totalRuns: 0,
      totalCompleted: 0,
      totalErrors: 0,
      lastRun: null
    };

    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Set up event listeners for worker events
    this.initializeListeners();
  }

  /**
   * Initializes event listeners for worker events.
   * @private
   */
  initializeListeners() {
    if (!this.eventEmitter_) {
      return;
    }

    // Store named listener references for cleanup in destroy()
    this.listeners_ = {
      'worker:start': (data) => {
        this.recordTaskStart(data.scriptPath, data.taskId);
      },
      'worker:status': (data) => {
        if (data.status === 'completed') {
          this.recordTaskCompletion(data.taskId);
        } else if (data.status === 'error') {
          this.recordTaskError(data.taskId);
        }
      },
      'worker:error': (data) => {
        this.recordTaskError(data.taskId);
      },
      'worker:exit:error': (data) => {
        this.recordTaskError(data.taskId);
      }
    };

    // Register event listeners
    for (const [eventName, listener] of Object.entries(this.listeners_)) {
      this.eventEmitter_.on(eventName, listener);
    }
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
    this.taskAnalytics_.clear();
    this.totals_ = {
      totalRuns: 0,
      totalCompleted: 0,
      totalErrors: 0,
      lastRun: null
    };
  }

  /**
   * Records the start of a task.
   * @private
   * @param {string} scriptPath - The script path of the task.
   * @param {string} taskId - The unique task ID.
   */
  recordTaskStart(scriptPath, taskId) {
    // Initialize task analytics if it doesn't exist
    if (!this.taskAnalytics_.has(scriptPath)) {
      this.taskAnalytics_.set(scriptPath, {
        scriptPath: scriptPath,
        runCount: 0,
        completedCount: 0,
        errorCount: 0,
        lastRun: null,
        averageDuration: 0,
        totalDuration: 0,
        activeTasks: new Map() // taskId -> start time
      });
    }

    const analytics = this.taskAnalytics_.get(scriptPath);
    const now = new Date();

    // Record task start
    analytics.activeTasks.set(taskId, now);
    analytics.runCount++;
    analytics.lastRun = now.toISOString();

    // Update totals
    this.totals_.totalRuns++;
    this.totals_.lastRun = now.toISOString();
  }

  /**
   * Records the completion of a task.
   * @private
   * @param {string} taskId - The unique task ID.
   */
  recordTaskCompletion(taskId) {
    // Find the task analytics that contains this taskId
    for (const [scriptPath, analytics] of this.taskAnalytics_.entries()) {
      if (analytics.activeTasks.has(taskId)) {
        const startTime = analytics.activeTasks.get(taskId);
        const duration = Date.now() - startTime.getTime();

        // Update analytics
        analytics.completedCount++;
        analytics.totalDuration += duration;
        analytics.averageDuration = Math.round(analytics.totalDuration / analytics.completedCount);

        // Remove from active tasks
        analytics.activeTasks.delete(taskId);

        // Update totals
        this.totals_.totalCompleted++;

        break;
      }
    }
  }

  /**
   * Records an error for a task.
   * @private
   * @param {string} taskId - The unique task ID.
   */
  recordTaskError(taskId) {
    // Find the task analytics that contains this taskId
    for (const [scriptPath, analytics] of this.taskAnalytics_.entries()) {
      if (analytics.activeTasks.has(taskId)) {
        const startTime = analytics.activeTasks.get(taskId);
        const duration = Date.now() - startTime.getTime();

        // Update analytics
        analytics.errorCount++;
        analytics.totalDuration += duration;

        // Remove from active tasks
        analytics.activeTasks.delete(taskId);

        // Update totals
        this.totals_.totalErrors++;

        break;
      }
    }
  }

  /**
   * Gets overall statistics totals.
   * @return {Object} Statistics object with total counts and percentages.
   */
  getStats() {
    const total = this.totals_.totalRuns;

    // Calculate percentages
    const completedPercentage = total > 0 ? ((this.totals_.totalCompleted / total) * 100).toFixed(2) : 0;
    const errorPercentage = total > 0 ? ((this.totals_.totalErrors / total) * 100).toFixed(2) : 0;
    const activePercentage = total > 0
      ? (((total - this.totals_.totalCompleted - this.totals_.totalErrors) / total) * 100).toFixed(2)
      : 0;

    return {
      total: total,
      counts: {
        completed: this.totals_.totalCompleted,
        errors: this.totals_.totalErrors,
        active: total - this.totals_.totalCompleted - this.totals_.totalErrors
      },
      percentages: {
        completed: parseFloat(completedPercentage),
        errors: parseFloat(errorPercentage),
        active: parseFloat(activePercentage)
      },
      lastRun: this.totals_.lastRun
    };
  }

  /**
   * Gets detailed analytics for all tasks ordered by last run date (newest first).
   * @return {Array<Object>} Array of task analytics.
   */
  getTaskAnalytics() {
    // Convert map to array and remove activeTasks from output
    const analytics = Array.from(this.taskAnalytics_.values()).map(task => ({
      scriptPath: task.scriptPath,
      runCount: task.runCount,
      completedCount: task.completedCount,
      errorCount: task.errorCount,
      lastRun: task.lastRun,
      averageDuration: task.averageDuration,
      activeCount: task.activeTasks.size
    }));

    // Sort by last run date (newest first)
    analytics.sort((a, b) => {
      if (!a.lastRun) return 1;
      if (!b.lastRun) return -1;
      return new Date(b.lastRun) - new Date(a.lastRun);
    });

    return analytics;
  }

  /**
   * Gets analytics for a specific task by script path.
   * @param {string} scriptPath - The script path to look up.
   * @return {?Object} Task analytics or null if not found.
   */
  getTaskAnalyticsByPath(scriptPath) {
    const task = this.taskAnalytics_.get(scriptPath);
    if (!task) {
      return null;
    }

    return {
      scriptPath: task.scriptPath,
      runCount: task.runCount,
      completedCount: task.completedCount,
      errorCount: task.errorCount,
      lastRun: task.lastRun,
      averageDuration: task.averageDuration,
      activeCount: task.activeTasks.size
    };
  }

  /**
   * Clears all analytics data.
   * @return {void}
   */
  clear() {
    this.taskAnalytics_.clear();
    this.totals_ = {
      totalRuns: 0,
      totalCompleted: 0,
      totalErrors: 0,
      lastRun: null
    };
  }
}

module.exports = WorkingAnalytics;
