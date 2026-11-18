/**
 * @fileoverview Analytics module for scheduling service
 * Tracks schedule execution statistics including pending, running, completed, and errored states.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Singleton class for tracking scheduling analytics
 * Maintains execution counts and status information for scheduled tasks
 */
class SchedulingAnalytics {
  constructor() {
    this.reset();
  }

  /**
   * Resets all tracked analytics state. Used by tests and by long-running
   * processes that need to clear historical data.
   */
  reset() {
    // Map of schedule name -> { schedule, pending, running, completed, error,
    // skipped, lastRun, cron, activity, createdAt }
    this.schedules = new Map();

    // Total counts across all schedules
    this.totals = {
      schedules: 0,
      pending: 0,
      running: 0,
      completed: 0,
      error: 0,
      skipped: 0
    };

    // Track execution history per schedule
    this.executionHistory = new Map();
  }

  /**
   * Track when a schedule is started (created)
   * @param {string} scheduleName - Name of the schedule
   * @param {string} cron - CRON expression for the schedule
   * @param {*} activity - Activity/task definition to execute
   */
  trackScheduleStarted(scheduleName, cron, activity) {
    if (!this.schedules.has(scheduleName)) {
      this.schedules.set(scheduleName, {
        schedule: scheduleName,
        scheduleId: scheduleName,
        name: scheduleName,
        pending: 0,
        running: 0,
        completed: 0,
        error: 0,
        lastRun: new Date().toISOString(),
        cron: cron || 'N/A',
        activity: activity || null,
        createdAt: new Date().toISOString()
      });
      this.totals.schedules++;

      // Initialize execution history for this schedule
      this.executionHistory.set(scheduleName, []);
    }

    // Mark as pending initially
    const schedule = this.schedules.get(scheduleName);
    schedule.pending++;
    this.totals.pending++;
  }

  /**
   * Track when a schedule execution begins
   * @param {string} scheduleName - Name of the schedule
   */
  trackScheduleRunning(scheduleName) {
    if (!this.schedules.has(scheduleName)) {
      this.schedules.set(scheduleName, {
        schedule: scheduleName,
        pending: 0,
        running: 0,
        completed: 0,
        error: 0,
        lastRun: new Date().toISOString()
      });
      this.totals.schedules++;
    }

    const schedule = this.schedules.get(scheduleName);

    // Move from pending to running if there was a pending count
    if (schedule.pending > 0) {
      schedule.pending--;
      this.totals.pending--;
    }

    schedule.running++;
    schedule.lastRun = new Date().toISOString();
    this.totals.running++;
  }

  /**
   * Track when a schedule execution completes successfully
   * @param {string} scheduleName - Name of the schedule
   */
  trackScheduleCompleted(scheduleName) {
    if (!this.schedules.has(scheduleName)) {
      this.schedules.set(scheduleName, {
        schedule: scheduleName,
        pending: 0,
        running: 0,
        completed: 0,
        error: 0,
        lastRun: new Date().toISOString()
      });
      this.totals.schedules++;
    }

    const schedule = this.schedules.get(scheduleName);

    // Move from running to completed
    if (schedule.running > 0) {
      schedule.running--;
      this.totals.running--;
    }

    schedule.completed++;
    schedule.lastRun = new Date().toISOString();
    this.totals.completed++;
  }

  /**
   * Track when a schedule execution fails
   * @param {string} scheduleName - Name of the schedule
   */
  trackScheduleError(scheduleName) {
    if (!this.schedules.has(scheduleName)) {
      this.schedules.set(scheduleName, {
        schedule: scheduleName,
        pending: 0,
        running: 0,
        completed: 0,
        error: 0,
        lastRun: new Date().toISOString()
      });
      this.totals.schedules++;
    }

    const schedule = this.schedules.get(scheduleName);

    // Move from running to error
    if (schedule.running > 0) {
      schedule.running--;
      this.totals.running--;
    }

    schedule.error++;
    schedule.lastRun = new Date().toISOString();
    this.totals.error++;
  }

  /**
   * Track when a schedule execution was skipped due to concurrency limits.
   * @param {string} scheduleName - Name of the schedule
   */
  trackScheduleSkipped(scheduleName) {
    if (!this.schedules.has(scheduleName)) {
      this.schedules.set(scheduleName, {
        schedule: scheduleName,
        pending: 0,
        running: 0,
        completed: 0,
        error: 0,
        skipped: 0,
        lastRun: new Date().toISOString()
      });
      this.totals.schedules++;
    }
    const schedule = this.schedules.get(scheduleName);
    schedule.skipped = (schedule.skipped || 0) + 1;
    this.totals.skipped++;
  }

  /**
   * Track when a schedule is stopped
   * @param {string} scheduleName - Name of the schedule
   */
  trackScheduleStopped(scheduleName) {
    if (this.schedules.has(scheduleName)) {
      const schedule = this.schedules.get(scheduleName);

      // Clear any pending/running states when stopped
      if (schedule.pending > 0) {
        this.totals.pending -= schedule.pending;
        schedule.pending = 0;
      }
      if (schedule.running > 0) {
        this.totals.running -= schedule.running;
        schedule.running = 0;
      }
    }
  }

  /**
   * Get analytics for all schedules
   * @param {number} limit - Maximum number of schedules to return (default: 100)
   * @return {Array} Array of schedule analytics sorted by lastRun descending
   */
  getScheduleAnalytics(limit = 100) {
    const analyticsArray = Array.from(this.schedules.values());

    // Transform data to match expected format for dashboard
    const transformedArray = analyticsArray.map(item => ({
      name: item.schedule,           // Schedule name (taskName)
      scheduleId: item.schedule,     // Also provide as scheduleId for compatibility
      pending: item.pending,         // Pending count
      runCount: item.completed + item.error, // Total runs (completed + error)
      completeCount: item.completed, // Successfully completed count
      errorCount: item.error,        // Error count
      lastRun: item.lastRun,         // Last run timestamp
      cron: item.cron,               // CRON expression
      activity: item.activity,       // Activity definition
      createdAt: item.createdAt      // Creation timestamp
    }));

    // Sort by lastRun descending (most recent first)
    transformedArray.sort((a, b) => {
      return new Date(b.lastRun) - new Date(a.lastRun);
    });

    return transformedArray.slice(0, limit);
  }

  /**
   * Get total statistics across all schedules
   * @return {Object} Total counts for schedules, pending, running, completed, error
   */
  getTotalStats() {
    return { ...this.totals };
  }

  /**
   * Get all analytics data (totals + schedules)
   * @return {Object} Complete analytics data
   */
  getAllAnalytics() {
    const totals = this.getTotalStats();
    return {
      totalSchedules: totals.schedules,
      totalPending: totals.pending,
      totalRunning: totals.running,
      totalCompleted: totals.completed,
      totalErrors: totals.error,
      totalSkipped: totals.skipped || 0,
      schedules: this.getScheduleAnalytics()
    };
  }

  /**
   * Track execution of a schedule
   * @param {string} scheduleId - The schedule ID
   * @param {string} status - Execution status (pending, running, completed, error)
   * @param {*} data - Execution data/result
   */
  trackExecution(scheduleId, status, data = null) {
    if (!this.executionHistory.has(scheduleId)) {
      this.executionHistory.set(scheduleId, []);
    }

    const execution = {
      executionId: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scheduleId,
      status,
      startTime: new Date().toISOString(),
      data
    };

    const history = this.executionHistory.get(scheduleId);
    history.unshift(execution); // Add to front (most recent first)

    // Keep only last 50 executions per schedule
    if (history.length > 50) {
      history.pop();
    }
  }

  /**
   * Get execution history for a specific schedule
   * @param {string} scheduleId - The schedule ID
   * @param {number} limit - Maximum number of executions to return
   * @return {Array} Array of execution records
   */
  getExecutionHistory(scheduleId, limit = 20) {
    const history = this.executionHistory.get(scheduleId) || [];
    return history.slice(0, limit);
  }

  /**
   * Clear all analytics data. Alias for {@link reset}.
   */
  clear() {
    this.reset();
  }
}

// Export singleton instance
module.exports = new SchedulingAnalytics();
