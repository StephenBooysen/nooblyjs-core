/**
 * @fileoverview Workflow Analytics Module
 * Captures and stores analytics about workflow executions including run counts, error counts,
 * completion counts, duration, and last run timestamps for each unique workflow.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

/**
 * A class that captures and stores workflow execution analytics.
 * Tracks per-workflow statistics and overall totals.
 * @class
 */
class WorkflowAnalytics {
  /**
   * Initializes the workflow analytics module.
   * @param {EventEmitter} eventEmitter - Event emitter to listen for workflow events.
   */
  constructor(eventEmitter) {
    /** @private {Map} Workflow analytics by workflow name */
    this.workflowAnalytics_ = new Map();

    /** @private {Object} Overall totals */
    this.totals_ = {
      totalRuns: 0,
      totalCompleted: 0,
      totalErrors: 0,
      lastRun: null
    };

    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Set up event listeners for workflow events
    this.initializeListeners_();
  }

  /**
   * Initializes event listeners for workflow events.
   * @private
   */
  initializeListeners_() {
    if (!this.eventEmitter_) {
      return;
    }

    // Store listener references so they can be removed in destroy() (P2-6).
    this.listeners_ = {
      'workflow:start': (data) => {
        this.recordWorkflowStart_(data.workflowName, data.workflowId);
      },
      'workflow:complete': (data) => {
        this.recordWorkflowCompletion_(data.workflowId);
      },
      'workflow:error': (data) => {
        this.recordWorkflowError_(data.workflowId);
      }
    };

    for (const [event, handler] of Object.entries(this.listeners_)) {
      this.eventEmitter_.on(event, handler);
    }
  }

  /**
   * Removes all event listeners registered by this analytics module.
   * Call when the owning service is disposed to prevent listener leaks (P2-6).
   */
  destroy() {
    if (this.eventEmitter_ && this.listeners_) {
      for (const [event, handler] of Object.entries(this.listeners_)) {
        this.eventEmitter_.removeListener(event, handler);
      }
      this.listeners_ = null;
    }
  }

  /**
   * Records the start of a workflow.
   * @private
   * @param {string} workflowName - The name of the workflow.
   * @param {string} workflowId - The unique workflow execution ID.
   */
  recordWorkflowStart_(workflowName, workflowId) {
    // Initialize workflow analytics if it doesn't exist
    if (!this.workflowAnalytics_.has(workflowName)) {
      this.workflowAnalytics_.set(workflowName, {
        workflowName: workflowName,
        runCount: 0,
        completedCount: 0,
        errorCount: 0,
        lastRun: null,
        averageDuration: 0,
        totalDuration: 0,
        activeWorkflows: new Map() // workflowId -> start time
      });
    }

    const analytics = this.workflowAnalytics_.get(workflowName);
    const now = new Date();

    // Record workflow start
    analytics.activeWorkflows.set(workflowId, now);
    analytics.runCount++;
    analytics.lastRun = now.toISOString();

    // Update totals
    this.totals_.totalRuns++;
    this.totals_.lastRun = now.toISOString();
  }

  /**
   * Records the completion of a workflow.
   * @private
   * @param {string} workflowId - The unique workflow execution ID.
   */
  recordWorkflowCompletion_(workflowId) {
    // Find the workflow analytics that contains this workflowId
    for (const [workflowName, analytics] of this.workflowAnalytics_.entries()) {
      if (analytics.activeWorkflows.has(workflowId)) {
        const startTime = analytics.activeWorkflows.get(workflowId);
        const duration = Date.now() - startTime.getTime();

        // Update analytics
        analytics.completedCount++;
        analytics.totalDuration += duration;
        analytics.averageDuration = Math.round(analytics.totalDuration / analytics.completedCount);

        // Remove from active workflows
        analytics.activeWorkflows.delete(workflowId);

        // Update totals
        this.totals_.totalCompleted++;

        break;
      }
    }
  }

  /**
   * Records an error for a workflow.
   * @private
   * @param {string} workflowId - The unique workflow execution ID.
   */
  recordWorkflowError_(workflowId) {
    // Find the workflow analytics that contains this workflowId
    for (const [workflowName, analytics] of this.workflowAnalytics_.entries()) {
      if (analytics.activeWorkflows.has(workflowId)) {
        const startTime = analytics.activeWorkflows.get(workflowId);
        const duration = Date.now() - startTime.getTime();

        // Update analytics
        analytics.errorCount++;
        analytics.totalDuration += duration;

        // Remove from active workflows
        analytics.activeWorkflows.delete(workflowId);

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
   * Gets detailed analytics for all workflows ordered by last run date (newest first).
   * @return {Array<Object>} Array of workflow analytics.
   */
  getWorkflowAnalytics() {
    // Convert map to array and remove activeWorkflows from output
    const analytics = Array.from(this.workflowAnalytics_.values()).map(workflow => ({
      workflowName: workflow.workflowName,
      runCount: workflow.runCount,
      completedCount: workflow.completedCount,
      errorCount: workflow.errorCount,
      lastRun: workflow.lastRun,
      averageDuration: workflow.averageDuration,
      activeCount: workflow.activeWorkflows.size
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
   * Gets analytics for a specific workflow by name.
   * @param {string} workflowName - The workflow name to look up.
   * @return {?Object} Workflow analytics or null if not found.
   */
  getWorkflowAnalyticsByName(workflowName) {
    const workflow = this.workflowAnalytics_.get(workflowName);
    if (!workflow) {
      return null;
    }

    return {
      workflowName: workflow.workflowName,
      runCount: workflow.runCount,
      completedCount: workflow.completedCount,
      errorCount: workflow.errorCount,
      lastRun: workflow.lastRun,
      averageDuration: workflow.averageDuration,
      activeCount: workflow.activeWorkflows.size
    };
  }

  /**
   * Clears all analytics data.
   * @return {void}
   */
  clear() {
    this.workflowAnalytics_.clear();
    this.totals_ = {
      totalRuns: 0,
      totalCompleted: 0,
      totalErrors: 0,
      lastRun: null
    };
  }
}

module.exports = WorkflowAnalytics;
