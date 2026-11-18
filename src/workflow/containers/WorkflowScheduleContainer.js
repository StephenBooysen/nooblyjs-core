/**
 * @fileoverview Workflow Schedule Container
 * Stores workflow schedule records in memory: which workflow runs, on what
 * cadence, with what input, and the schedule's own run bookkeeping (lastRun,
 * lastResult, lastError, executionCount, nextRun).
 *
 * The container only stores records; timing lives in
 * {@link module:workflow/modules/workflowScheduler}. Persistence is left to the
 * consuming application via {@link WorkflowScheduleContainer#export} /
 * {@link WorkflowScheduleContainer#import}.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.1.0
 */

'use strict';

const crypto = require('node:crypto');

/** @const {!Array<string>} Fields a caller may change on an existing schedule. */
const MUTABLE_FIELDS = [
  'name', 'description', 'cronExpression', 'interval', 'input', 'enabled',
  'nextRun', 'lastRun', 'lastResult', 'lastError', 'lastExecutionId',
  'lastDuration', 'executionCount', 'activationError', 'workflowName'
];

/**
 * WorkflowScheduleContainer - in-memory store of workflow schedules.
 */
class WorkflowScheduleContainer {
  /**
   * Creates a new WorkflowScheduleContainer instance.
   */
  constructor() {
    /** @private {!Map<string, !Object>} Schedules keyed by id */
    this.schedules = new Map();
  }

  /**
   * Returns a detached copy of a schedule record, with the `workflowId`
   * alias the list views use.
   * @param {!Object} schedule The stored record
   * @return {!Object} A copy safe to hand to callers
   * @private
   */
  view_(schedule) {
    return { ...schedule, workflowId: schedule.workflowName };
  }

  /**
   * Creates a schedule record.
   *
   * @param {Object} data - Schedule data
   * @param {string} data.workflowName - Workflow the schedule runs
   * @param {string} data.name - Display name
   * @param {string} [data.id] - Explicit id (generated when omitted)
   * @param {string} [data.description] - Free-text description
   * @param {?string} [data.cronExpression] - 5-field cron expression
   * @param {?number} [data.interval] - Interval in milliseconds
   * @param {Object} [data.input] - Input passed to each run
   * @param {boolean} [data.enabled=true] - Whether the schedule fires
   * @param {?string} [data.nextRun] - Next planned fire time (ISO)
   * @return {!Object} The created schedule
   * @throws {Error} When the id is already in use
   */
  create(data) {
    const id = data.id || crypto.randomUUID();
    if (this.schedules.has(id)) {
      throw new Error(`Schedule '${id}' already exists`);
    }
    const now = new Date().toISOString();
    const schedule = {
      id,
      workflowName: data.workflowName,
      name: data.name,
      description: data.description || '',
      cronExpression: data.cronExpression || data.cron || null,
      interval: data.interval || null,
      input: data.input && typeof data.input === 'object' ? data.input : {},
      enabled: data.enabled !== false,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      nextRun: data.nextRun || null,
      lastRun: data.lastRun || null,
      lastResult: data.lastResult || null,
      lastError: data.lastError || null,
      lastExecutionId: data.lastExecutionId || null,
      lastDuration: data.lastDuration || null,
      executionCount: data.executionCount || 0,
      activationError: data.activationError || null
    };
    this.schedules.set(id, schedule);
    return this.view_(schedule);
  }

  /**
   * Retrieves a schedule by id.
   * @param {string} id - Schedule id
   * @return {?Object} The schedule, or null if not found
   */
  get(id) {
    const schedule = this.schedules.get(id);
    return schedule ? this.view_(schedule) : null;
  }

  /**
   * Returns the live stored record (internal use by the scheduler).
   * @param {string} id - Schedule id
   * @return {?Object} The stored record
   */
  getRecord(id) {
    return this.schedules.get(id) || null;
  }

  /**
   * Merges changes into a schedule. Unknown fields are ignored.
   * @param {string} id - Schedule id
   * @param {Object} changes - Fields to change
   * @return {?Object} The updated schedule, or null if not found
   */
  update(id, changes) {
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    for (const key of MUTABLE_FIELDS) {
      if (changes[key] !== undefined) schedule[key] = changes[key];
    }
    schedule.updatedAt = new Date().toISOString();
    return this.view_(schedule);
  }

  /**
   * Deletes a schedule.
   * @param {string} id - Schedule id
   * @return {boolean} True if deleted
   */
  delete(id) {
    return this.schedules.delete(id);
  }

  /**
   * Lists schedules, soonest next run first.
   * @param {Object} [options] - Filters
   * @param {string} [options.workflowName] - Only this workflow's schedules
   * @param {boolean} [options.enabled] - Only enabled (true) or paused (false)
   * @return {!Array<!Object>} Matching schedules
   */
  list(options = {}) {
    let result = Array.from(this.schedules.values());
    if (options.workflowName) {
      result = result.filter(s => s.workflowName === options.workflowName);
    }
    if (typeof options.enabled === 'boolean') {
      result = result.filter(s => s.enabled === options.enabled);
    }
    result.sort((a, b) => {
      // Paused / never-firing schedules sink below those with a real next run.
      const aTime = a.nextRun ? new Date(a.nextRun).getTime() : Infinity;
      const bTime = b.nextRun ? new Date(b.nextRun).getTime() : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.name).localeCompare(String(b.name));
    });
    return result.map(s => this.view_(s));
  }

  /**
   * Returns the ids of every stored schedule.
   * @return {!Array<string>} Schedule ids
   */
  ids() {
    return Array.from(this.schedules.keys());
  }

  /**
   * Returns the number of schedules.
   * @return {number} Schedule count
   */
  count() {
    return this.schedules.size;
  }

  /**
   * Removes every schedule.
   */
  clear() {
    this.schedules.clear();
  }

  /**
   * Exports schedules as a JSON-compatible array.
   * @return {!Array<!Object>} Schedule records
   */
  export() {
    return Array.from(this.schedules.values()).map(s => ({ ...s }));
  }

  /**
   * Imports schedules, replacing any with the same id. Records written by
   * callers that key schedules by `workflowId` are accepted too.
   * @param {!Array<!Object>} data - Schedule records
   * @return {number} Number of schedules imported
   * @throws {Error} When data is not an array
   */
  import(data) {
    if (!Array.isArray(data)) {
      throw new Error('Schedule import data must be an array');
    }
    let imported = 0;
    for (const record of data) {
      if (!record || !record.id) continue;
      const workflowName = record.workflowName || record.workflowId;
      if (!workflowName) continue;
      this.schedules.delete(record.id);
      this.create({ ...record, workflowName });
      imported++;
    }
    return imported;
  }
}

module.exports = WorkflowScheduleContainer;
