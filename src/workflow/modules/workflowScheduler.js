/**
 * @fileoverview Workflow Scheduler
 * Fires workflow schedules held in a {@link WorkflowScheduleContainer} on their
 * cron expression or interval, and keeps each schedule's own bookkeeping
 * (nextRun, lastRun, lastResult, lastError, executionCount) up to date.
 *
 * Why the workflow service schedules its own runs rather than handing them to
 * the scheduling service: the scheduling service dispatches a *script* to a
 * worker thread, but a workflow run is orchestrated in-process (each step is
 * dispatched to the working service in turn, and its execution record lives in
 * this process's memory). Running the workflow from a worker would put its
 * history in a different process. The cron grammar is shared - expressions are
 * parsed by the scheduling service's `cronExpression` module - so an expression
 * is valid here exactly when it is valid there.
 *
 * Scheduling is driven by `nextRun`, not by matching the current minute:
 *  - a single timer is armed for the soonest `nextRun` (re-checked at least
 *    every minute), so interval schedules shorter than a minute work and a
 *    cron minute cannot be skipped by timer drift;
 *  - a fire that is overdue by more than the grace period (the event loop
 *    stalled, the host slept, or the consuming application re-imported
 *    schedules after a restart) is treated as *missed*: `nextRun` is advanced
 *    first, then the missed run is replayed once (catch-up), staggered so a
 *    batch of overdue schedules doesn't start at once. Catch-up can be turned
 *    off, in which case `nextRun` is only repaired;
 *  - a schedule whose previous run is still in flight skips the fire rather
 *    than overlapping itself.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.1.0
 */

'use strict';

const { parseCron, nextMatch } = require('../../scheduling/providers/cronExpression');

/** @const {number} Longest the timer sleeps before re-checking schedules. */
const MAX_TICK_MS = 60 * 1000;

/** @const {number} Shortest timer delay, so a tight loop can't starve the event loop. */
const MIN_TICK_MS = 250;

/** @const {number} How late a fire may be before it counts as missed. */
const DEFAULT_CATCHUP_GRACE_MS = 2 * 60 * 1000;

/** @const {number} Gap between catch-up runs dispatched in the same pass. */
const DEFAULT_CATCHUP_STAGGER_MS = 20 * 1000;

/** @const {number} Shortest interval schedule accepted, in milliseconds. */
const MIN_INTERVAL_MS = 1000;

/** @const {number} How far ahead to search for a cron expression's next match. */
const NEXT_RUN_HORIZON_MS = 5 * 366 * 24 * 60 * 60 * 1000;

/**
 * Error raised for invalid schedule input. Carries an HTTP status so routes
 * can answer 400 rather than 500.
 */
class ScheduleValidationError extends Error {
  /**
   * @param {string} message - What was wrong
   */
  constructor(message) {
    super(message);
    this.name = 'ScheduleValidationError';
    this.statusCode = 400;
  }
}

/**
 * Finds the first minute strictly after `from` that a cron expression matches.
 * Thin wrapper over the scheduling service's `nextMatch`, kept so callers of
 * this module have one import for everything schedule related.
 *
 * @param {string|!Object} cron - Cron expression or parsed descriptor
 * @param {!Date} [from=new Date()] - Search start (exclusive)
 * @return {?Date} The next matching minute, or null if none within the horizon
 */
function nextCronMatch(cron, from = new Date()) {
  return nextMatch(cron, from, NEXT_RUN_HORIZON_MS);
}

/**
 * WorkflowScheduler - fires stored workflow schedules.
 */
class WorkflowScheduler {
  /**
   * @param {Object} options - Scheduler options
   * @param {!WorkflowScheduleContainer} options.store - Schedule store
   * @param {function(!Object, !Object): !Promise<!Object>} options.run - Runs a
   *   schedule's workflow: `(schedule, { trigger }) => execution`
   * @param {?Object} [options.logger] - Logging service
   * @param {?EventEmitter} [options.eventEmitter] - Global event emitter
   * @param {function(string, !Object)} [options.onChange] - Called after a
   *   schedule record changes: `(scheduleId, schedule)`
   * @param {boolean} [options.catchUp=true] - Replay missed fires once
   * @param {number} [options.catchUpGraceMs=120000] - Lateness that counts as missed
   * @param {number} [options.catchUpStaggerMs=20000] - Gap between catch-up runs
   * @param {boolean} [options.autoStart=true] - Arm the timer when schedules exist
   */
  constructor(options) {
    /** @private @const */
    this.store_ = options.store;
    /** @private @const */
    this.run_ = options.run;
    /** @type {?Object} */
    this.logger = options.logger || null;
    /** @private @const */
    this.eventEmitter_ = options.eventEmitter || null;
    /** @private @const */
    this.onChange_ = typeof options.onChange === 'function' ? options.onChange : () => {};

    /** @type {boolean} */
    this.catchUp = options.catchUp !== false;
    /** @type {number} */
    this.catchUpGraceMs = Number.isFinite(options.catchUpGraceMs)
      ? options.catchUpGraceMs : DEFAULT_CATCHUP_GRACE_MS;
    /** @type {number} */
    this.catchUpStaggerMs = Number.isFinite(options.catchUpStaggerMs)
      ? options.catchUpStaggerMs : DEFAULT_CATCHUP_STAGGER_MS;
    /** @type {boolean} */
    this.autoStart = options.autoStart !== false;

    /** @private {?NodeJS.Timeout} */
    this.timer_ = null;
    /** @private {!Set<string>} Schedules with a run in flight */
    this.inFlight_ = new Set();
    /** @private {!Set<NodeJS.Timeout>} Pending staggered catch-up timers */
    this.pending_ = new Set();
    /** @private {boolean} */
    this.stopped_ = false;
  }

  // ---------------------------------------------------------------------------
  // Validation and next-run calculation
  // ---------------------------------------------------------------------------

  /**
   * Validates a cron expression, including that it can ever fire.
   * @param {string} expression - 5-field cron expression
   * @return {!Date} The expression's next fire time
   * @throws {ScheduleValidationError} When the expression is malformed or never fires
   */
  validateCron(expression) {
    let parsed;
    try {
      parsed = parseCron(expression);
    } catch (err) {
      throw new ScheduleValidationError(`Invalid cron expression "${expression}": ${err.message}`);
    }
    const next = nextCronMatch(parsed);
    if (!next) {
      throw new ScheduleValidationError(`Cron expression "${expression}" never fires`);
    }
    return next;
  }

  /**
   * Validates an interval in milliseconds.
   * @param {*} interval - Candidate interval
   * @return {number} The interval as an integer
   * @throws {ScheduleValidationError} When the interval is not a number or too short
   */
  validateInterval(interval) {
    const ms = Number(interval);
    if (!Number.isFinite(ms) || ms < MIN_INTERVAL_MS) {
      throw new ScheduleValidationError(`Interval must be a number of milliseconds >= ${MIN_INTERVAL_MS}`);
    }
    return Math.floor(ms);
  }

  /**
   * Describes the next few fire times of a cron expression.
   * @param {string} expression - 5-field cron expression
   * @param {number} [count=5] - How many fire times to return
   * @return {{valid: boolean, error: ?string, nextRuns: !Array<string>}}
   */
  previewCron(expression, count = 5) {
    try {
      let next = this.validateCron(expression);
      const parsed = parseCron(expression);
      const nextRuns = [];
      while (next && nextRuns.length < count) {
        nextRuns.push(next.toISOString());
        next = nextCronMatch(parsed, next);
      }
      return { valid: true, error: null, nextRuns };
    } catch (err) {
      return { valid: false, error: err.message, nextRuns: [] };
    }
  }

  /**
   * Calculates a schedule's next fire time after a given moment.
   * @param {!Object} schedule - Schedule record
   * @param {!Date} [from=new Date()] - Reference time
   * @return {?string} ISO timestamp, or null when the schedule cannot fire
   */
  nextRunFor(schedule, from = new Date()) {
    if (schedule.cronExpression) {
      try {
        const next = nextCronMatch(schedule.cronExpression, from);
        return next ? next.toISOString() : null;
      } catch (_err) {
        return null;
      }
    }
    if (schedule.interval) {
      return new Date(from.getTime() + Number(schedule.interval)).toISOString();
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  /**
   * Re-arms the timer for the soonest enabled schedule. Idempotent; called
   * after any schedule change. Does nothing once stopped or when autoStart is
   * off and the timer was never started explicitly.
   */
  arm() {
    if (this.stopped_ || !this.autoStart) return;
    if (this.timer_) {
      clearTimeout(this.timer_);
      this.timer_ = null;
    }

    const enabled = this.store_.list({ enabled: true });
    if (enabled.length === 0) return;

    const now = Date.now();
    let soonest = now + MAX_TICK_MS;
    for (const schedule of enabled) {
      const at = schedule.nextRun ? new Date(schedule.nextRun).getTime() : now;
      if (Number.isFinite(at) && at < soonest) soonest = at;
    }
    const delay = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, soonest - now + 50));

    this.timer_ = setTimeout(() => {
      this.timer_ = null;
      this.tick();
      this.arm();
    }, delay);
    if (typeof this.timer_.unref === 'function') this.timer_.unref();
  }

  /**
   * Starts (or restarts) the timer even if autoStart was off.
   */
  start() {
    this.stopped_ = false;
    this.autoStart = true;
    this.arm();
  }

  /**
   * Stops the timer and any pending catch-up runs. Runs already in flight
   * finish normally.
   */
  stop() {
    this.stopped_ = true;
    if (this.timer_) clearTimeout(this.timer_);
    this.timer_ = null;
    for (const handle of this.pending_) clearTimeout(handle);
    this.pending_.clear();
  }

  /**
   * Evaluates every enabled schedule against the clock and dispatches the
   * ones that are due. Exposed so tests and consumers can drive the scheduler
   * with a fixed clock.
   *
   * @param {number} [now=Date.now()] - The current time in epoch ms
   * @return {{fired: number, caughtUp: number, missed: number, skipped: number, repaired: number}}
   */
  tick(now = Date.now()) {
    const result = { fired: 0, caughtUp: 0, missed: 0, skipped: 0, repaired: 0 };

    for (const schedule of this.store_.list({ enabled: true })) {
      const record = this.store_.getRecord(schedule.id);
      if (!record) continue;

      const nextRunMs = record.nextRun ? new Date(record.nextRun).getTime() : NaN;

      if (Number.isNaN(nextRunMs)) {
        const nextRun = this.nextRunFor(record, new Date(now));
        if (nextRun !== record.nextRun) {
          this.update_(record.id, { nextRun });
          result.repaired++;
        }
        continue;
      }

      if (nextRunMs > now) continue; // not due yet

      const missedRun = record.nextRun;
      const overdueBy = now - nextRunMs;
      // Advance BEFORE dispatching, so a slow or failing run can never cause
      // the same fire to be replayed on the next tick.
      this.update_(record.id, { nextRun: this.nextRunFor(record, new Date(now)) });

      if (this.inFlight_.has(record.id)) {
        result.skipped++;
        this.emit_('workflow:schedule:skipped', {
          scheduleId: record.id,
          workflowName: record.workflowName,
          reason: 'previous-run-in-flight',
          plannedAt: missedRun
        });
        this.logger?.warn?.('[WorkflowScheduler] Skipped fire: previous run still in flight', {
          scheduleId: record.id,
          workflowName: record.workflowName
        });
        continue;
      }

      if (overdueBy <= this.catchUpGraceMs) {
        result.fired++;
        this.dispatch(record.id, { trigger: 'schedule' });
        continue;
      }

      if (!this.catchUp) {
        result.missed++;
        this.emit_('workflow:schedule:missed', {
          scheduleId: record.id,
          workflowName: record.workflowName,
          missedRun
        });
        this.logger?.warn?.('[WorkflowScheduler] Schedule missed a run; nextRun repaired (catch-up disabled)', {
          scheduleId: record.id,
          missedRun
        });
        continue;
      }

      this.logger?.warn?.('[WorkflowScheduler] Schedule missed a run - replaying it', {
        scheduleId: record.id,
        workflowName: record.workflowName,
        missedRun
      });
      const delay = result.caughtUp * this.catchUpStaggerMs;
      result.caughtUp++;
      if (delay > 0) {
        const handle = setTimeout(() => {
          this.pending_.delete(handle);
          this.dispatch(record.id, { trigger: 'catch-up' });
        }, delay);
        if (typeof handle.unref === 'function') handle.unref();
        this.pending_.add(handle);
      } else {
        this.dispatch(record.id, { trigger: 'catch-up' });
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  /**
   * Whether a schedule has a run in flight.
   * @param {string} scheduleId - Schedule id
   * @return {boolean} True while a run started by this schedule is executing
   */
  isRunning(scheduleId) {
    return this.inFlight_.has(scheduleId);
  }

  /**
   * Runs a schedule's workflow now and records the outcome on the schedule.
   * Used for timed fires, catch-up replays and "run now".
   *
   * @param {string} scheduleId - Schedule id
   * @param {Object} [options] - Dispatch options
   * @param {string} [options.trigger='schedule'] - Recorded on the execution
   * @return {!Promise<?Object>} The execution record, or null if the schedule is gone
   */
  async dispatch(scheduleId, options = {}) {
    const record = this.store_.getRecord(scheduleId);
    if (!record) return null;
    const trigger = options.trigger || 'schedule';
    const startedAt = new Date().toISOString();

    this.inFlight_.add(scheduleId);
    this.update_(scheduleId, { lastRun: startedAt, lastResult: 'running', lastError: null });
    this.emit_('workflow:schedule:fired', {
      scheduleId,
      scheduleName: record.name,
      workflowName: record.workflowName,
      trigger
    });

    let execution = null;
    let failure = null;
    try {
      execution = await this.run_({ ...record }, { trigger });
    } catch (err) {
      failure = err;
    } finally {
      this.inFlight_.delete(scheduleId);
    }

    const current = this.store_.getRecord(scheduleId);
    if (!current) return execution; // deleted while running

    const succeeded = !failure && execution && execution.outcome === 'success';
    const errorMessage = failure
      ? failure.message
      : (succeeded ? null : (execution && execution.error) || 'Workflow run failed');

    this.update_(scheduleId, {
      lastResult: succeeded ? 'success' : 'failed',
      lastError: errorMessage,
      lastExecutionId: execution ? execution.executionId : null,
      lastDuration: execution ? execution.duration : null,
      executionCount: (current.executionCount || 0) + 1
    });

    this.emit_('workflow:schedule:completed', {
      scheduleId,
      scheduleName: current.name,
      workflowName: current.workflowName,
      trigger,
      outcome: succeeded ? 'success' : 'failed',
      executionId: execution ? execution.executionId : null,
      error: errorMessage
    });

    return execution;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Applies changes to a schedule record and notifies the owner.
   * @param {string} id - Schedule id
   * @param {!Object} changes - Fields to change
   * @private
   */
  update_(id, changes) {
    const updated = this.store_.update(id, changes);
    if (updated) this.onChange_(id, updated);
  }

  /**
   * Emits an event if an emitter is attached.
   * @param {string} name - Event name
   * @param {!Object} payload - Event payload
   * @private
   */
  emit_(name, payload) {
    this.eventEmitter_?.emit(name, payload);
  }
}

module.exports = {
  WorkflowScheduler,
  ScheduleValidationError,
  nextCronMatch,
  MIN_INTERVAL_MS
};
