/**
 * @fileoverview Execution record projection and classification.
 *
 * Execution records hold the workflow's full input, output and per-step
 * payloads, which for heavy workflows can be many MB each. A list endpoint that
 * returned whole records could build a response larger than the browser can
 * parse (`response.json()` throws `RangeError: Invalid string length`), so
 * lists only ever carry the summary fields below. The full record is fetched
 * on demand by id.
 *
 * NOTE: never stringify `outputData` to measure it here - a very large payload
 * would throw the same RangeError server-side. `hasResult` is a cheap null
 * check instead.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.1.0
 */

'use strict';

/** @const {!Array<string>} Fields an execution list row carries. */
const EXEC_LIST_FIELDS = [
  'id', 'executionId', 'workflowId', 'workflowName', 'group',
  'startedAt', 'endedAt', 'completedAt', 'duration',
  'status', 'outcome', 'error', 'trigger', 'scheduleId', 'scheduleName',
  'stepCount', 'currentStep'
];

/** @const {number} Longest error message a list row carries. */
const MAX_LIST_ERROR_CHARS = 500;

/**
 * Projects an execution record down to the fields a list view needs.
 *
 * @param {?Object} execution The full execution record.
 * @return {?Object} The summary record.
 *
 * @example
 * const row = summarizeExecution(execution);
 * // { id, workflowName, status, outcome, duration, hasResult, ... }
 */
function summarizeExecution(execution) {
  if (!execution || typeof execution !== 'object') return execution;
  const slim = {};
  for (const key of EXEC_LIST_FIELDS) {
    if (execution[key] !== undefined) slim[key] = execution[key];
  }
  if (typeof slim.error === 'string' && slim.error.length > MAX_LIST_ERROR_CHARS) {
    slim.error = `${slim.error.slice(0, MAX_LIST_ERROR_CHARS)}…`;
  }
  slim.hasResult = execution.outputData != null;
  return slim;
}

/**
 * Projects a list of execution records.
 *
 * @param {?Array<!Object>} list Full execution records.
 * @return {?Array<!Object>} Summary records.
 */
function summarizeExecutions(list) {
  return Array.isArray(list) ? list.map(summarizeExecution) : list;
}

/**
 * Classifies a record into one of the outcome buckets the UI filters by.
 * Records from different callers disagree on which field carries the verdict
 * (`status` is completed/error/running, `outcome` is success/failed), so both
 * are consulted.
 *
 * @param {?Object} execution The execution record.
 * @return {string} One of 'success', 'failed', 'running' or 'other'.
 */
function classifyExecution(execution) {
  const status = String((execution && execution.status) || '').toLowerCase();
  const outcome = String((execution && execution.outcome) || '').toLowerCase();
  if (status === 'running' || status === 'started') return 'running';
  if (['error', 'failed', 'cancelled'].includes(status)
      || ['failed', 'error', 'cancelled'].includes(outcome)) return 'failed';
  if (['completed', 'success', 'succeeded'].includes(status)
      || ['success', 'succeeded'].includes(outcome)) return 'success';
  return 'other';
}

module.exports = {
  EXEC_LIST_FIELDS,
  summarizeExecution,
  summarizeExecutions,
  classifyExecution
};
