/**
 * @fileoverview Production scheduling provider.
 *
 * Manages two kinds of scheduled tasks:
 *  - Interval tasks: fixed-period repeating jobs (`start()`)
 *  - CRON tasks: standard 5-field cron expressions (`startCron()`)
 *
 * Both kinds dispatch their work to the injected `working` service so the
 * scheduler itself never blocks the event loop. Tasks are governed by the
 * provider's settings:
 *  - `maxConcurrentJobs`: hard cap on simultaneous executions across the
 *    whole scheduler. Excess fires are skipped (and recorded) rather than
 *    queued, to prevent runaway pile-up if the worker pool is saturated.
 *  - `retryAttempts`: per-execution retry budget on failure (no retry on
 *    timeout — see below).
 *  - `jobTimeout`: per-execution wall-clock budget in milliseconds. If
 *    exceeded the execution is recorded as an error and not retried.
 *
 * @author NooblyJS Core Team
 * @version 2.0.0
 * @since 1.0.0
 */

'use strict';

const analytics = require('../modules/analytics');
const { parseCron, matches, isValid, nextMatch } = require('./cronExpression');

/** @const {number} How often to evaluate cron expressions, in ms (1 minute). */
const CRON_TICK_MS = 60 * 1000;

/**
 * @const {number} Offset into the minute at which the cron tick is scheduled.
 * The tick is re-aligned to the wall clock on every fire, and landing a little
 * way INTO the minute (rather than exactly on the boundary) keeps a timer that
 * fires a hair early from evaluating the previous minute twice.
 */
const CRON_TICK_OFFSET_MS = 250;

/**
 * @const {number} Upper bound on how many missed minutes a single tick will
 * replay. A tick can arrive late because the event loop stalled, the host was
 * suspended, or timers were coalesced. Without a replay the one minute a daily
 * cron needs can be skipped outright and the job silently does not run that
 * day. The cap stops a machine that slept for a week from replaying a week.
 */
const CRON_MAX_CATCHUP_MINUTES = 60;

/** @const {number} Default number of runs remembered per task. */
const DEFAULT_MAX_RUNS_PER_TASK = 50;

/** @const {number} Shortest interval accepted by {@link SchedulerProvider#update}, in seconds. */
const MIN_INTERVAL_SECONDS = 1;

/**
 * Production-grade scheduler provider.
 *
 * @class
 */
class SchedulerProvider {
  /**
   * @param {Object=} options Configuration options.
   * @param {number=} options.maxConcurrentJobs Cap on simultaneous executions.
   * @param {number=} options.retryAttempts Per-execution retries on failure.
   * @param {number=} options.jobTimeout Per-execution timeout in ms.
   * @param {EventEmitter=} eventEmitter Optional event emitter.
   * @param {Object=} workingService Working service used to execute tasks.
   */
  constructor(options = {}, eventEmitter, workingService) {
    /** @private @const {?EventEmitter} */
    this.eventEmitter_ = eventEmitter || null;

    /** @private @const {!Map<string, !Object>} */
    this.tasks_ = new Map();

    /**
     * Recent runs per task, newest first. Kept apart from the task record so
     * summaries stay small; removed with the task.
     * @private @const {!Map<string, !Array<!Object>>}
     */
    this.runs_ = new Map();

    /** @private @const {number} Runs remembered per task. */
    this.maxRunsPerTask_ = this.coerceNumber_(options.maxRunsPerTask, DEFAULT_MAX_RUNS_PER_TASK, 1);

    /** @private {number} Sequence for run ids. */
    this.runSeq_ = 0;

    /** @private @const {?Object} */
    this.worker_ = workingService || null;

    /** @private {?Object} Logger injected by the factory. */
    this.logger = null;

    /** @private {number} Currently-executing jobs across all schedules. */
    this.activeJobs_ = 0;

    /** @private {?NodeJS.Timeout} Single shared timer for cron evaluation. */
    this.cronTimer_ = null;

    /** @private {?Date} Last minute boundary already evaluated. */
    this.lastCronTick_ = null;

    /** @private {boolean} Set when {@link shutdown} has been called. */
    this.shuttingDown_ = false;

    // Settings configuration. Field metadata is exposed via getSettings()
    // for use by the settings UI; the actual values live alongside it.
    this.settings = {
      description: 'Configuration settings for the scheduling service',
      list: [
        { setting: 'maxConcurrentJobs', type: 'number', values: null },
        { setting: 'retryAttempts',     type: 'number', values: null },
        { setting: 'jobTimeout',        type: 'number', values: null }
      ],
      maxConcurrentJobs: this.coerceNumber_(options.maxConcurrentJobs, 10, 1),
      retryAttempts:     this.coerceNumber_(options.retryAttempts,      3, 0),
      jobTimeout:        this.coerceNumber_(options.jobTimeout,     30000, 1)
    };

    if (!this.worker_) {
      // The original implementation threw here. We instead emit a warning
      // and degrade to a no-op execution backend, because in some test and
      // bootstrap scenarios the working service is wired in later. Calls to
      // start()/startCron() will still record schedules and emit events;
      // they simply won't dispatch real work.
      this.logger?.warn?.(
        '[SchedulerProvider] Working service not provided — schedules will be recorded but no execution will occur.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /**
   * Returns the current settings object.
   * @return {Promise<!Object>} The settings.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Updates one or more settings. Unknown keys are ignored. Each accepted
   * setting is validated against its declared type before being applied.
   *
   * @param {!Object} settings A partial settings object.
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') return;

    for (const meta of this.settings.list) {
      const key = meta.setting;
      if (settings[key] === undefined || settings[key] === null) continue;

      const incoming = settings[key];

      if (meta.type === 'number') {
        const min = key === 'retryAttempts' ? 0 : 1;
        const value = this.coerceNumber_(incoming, this.settings[key], min);
        if (value === this.settings[key]) continue;
        this.settings[key] = value;
      } else {
        this.settings[key] = incoming;
      }

      this.eventEmitter_?.emit('scheduler:setting-changed', {
        setting: key,
        value: this.settings[key]
      });
      this.logger?.info?.('[SchedulerProvider] Setting changed', {
        setting: key,
        value: this.settings[key]
      });
    }
  }

  /**
   * Coerces a value into a positive integer with a fallback default.
   * @param {*} value The candidate value.
   * @param {number} fallback The fallback value if invalid.
   * @param {number} min Minimum allowed value (inclusive).
   * @return {number} A valid integer.
   * @private
   */
  coerceNumber_(value, fallback, min) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.floor(n);
  }

  // ---------------------------------------------------------------------------
  // Interval scheduling — start()
  // ---------------------------------------------------------------------------

  /**
   * Starts a new interval-based scheduled task. The task fires immediately
   * once and then every `intervalSeconds` thereafter.
   *
   * Supports three calling conventions for backward compatibility:
   *   start(name, scriptPath, intervalSeconds)
   *   start(name, scriptPath, intervalSeconds, callback)
   *   start(name, scriptPath, data, intervalSeconds, callback)
   *
   * @param {string} taskName Unique task name.
   * @param {string} scriptPath Activity script path passed to the worker.
   * @param {*|number} dataOrInterval Data payload, or interval (3-arg form).
   * @param {(number|Function)=} intervalSecondsOrCallback Interval or callback.
   * @param {Function=} executionCallback Optional callback `(status, data)`.
   * @param {Object=} options Extra options (5-argument form only).
   * @param {boolean=} options.paused Register the task paused.
   * @param {boolean=} options.runImmediately Fire once on registration (default true).
   * @param {?string=} options.description Free-text description.
   * @param {?string=} options.group Group the task is listed under.
   * @return {Promise<void>}
   * @throws {Error} On invalid arguments.
   */
  async start(taskName, scriptPath, dataOrInterval, intervalSecondsOrCallback, executionCallback, options = {}) {
    this.assertTaskName_(taskName, 'start');
    this.assertScriptPath_(scriptPath, taskName);

    // Resolve calling convention.
    let data;
    let interval;
    let callback;

    if (arguments.length === 3) {
      data = null;
      interval = dataOrInterval;
      callback = undefined;
    } else if (arguments.length === 4) {
      // Distinguish (name, path, interval, callback) from
      // (name, path, data, interval). When the 3rd arg is a number we treat
      // it as the interval; the 4th must then be the callback.
      if (typeof dataOrInterval === 'number') {
        data = null;
        interval = dataOrInterval;
        callback = intervalSecondsOrCallback;
      } else {
        data = dataOrInterval;
        interval = intervalSecondsOrCallback;
        callback = undefined;
      }
    } else {
      data = dataOrInterval;
      interval = intervalSecondsOrCallback;
      callback = executionCallback;
    }
    const startOptions = options && typeof options === 'object' ? options : {};

    if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
      this.throwValidation_('start', 'Invalid interval: must be a positive number', { taskName, interval });
    }
    if (callback !== undefined && typeof callback !== 'function') {
      this.throwValidation_('start', 'Invalid callback: must be a function if provided', { taskName });
    }

    if (this.tasks_.has(taskName)) {
      this.eventEmitter_?.emit('scheduler:start:error', {
        taskName,
        error: 'Task already scheduled.'
      });
      this.logger?.warn?.('[SchedulerProvider] Task already scheduled', { taskName });
      return;
    }

    const task = {
      type: 'interval',
      name: taskName,
      scriptPath,
      data,
      callback,
      intervalSeconds: interval,
      intervalId: null,
      createdAt: new Date().toISOString(),
      paused: startOptions.paused === true,
      lastTickAt: Date.now(),
      description: startOptions.description || null,
      group: startOptions.group || null
    };

    const fire = this.intervalFire_(task);

    // First execution runs immediately, then on the interval.
    task.intervalId = setInterval(fire, interval * 1000);
    this.tasks_.set(taskName, task);

    analytics.trackScheduleStarted(taskName);
    this.eventEmitter_?.emit('scheduler:started', {
      taskName,
      scriptPath,
      intervalSeconds: interval
    });
    this.logger?.info?.('[SchedulerProvider] Interval task started', {
      taskName,
      scriptPath,
      intervalSeconds: interval
    });

    // Fire the first execution after the task is registered so cancellation
    // during the first call still finds the task in the map.
    if (startOptions.runImmediately !== false) fire();
  }

  // ---------------------------------------------------------------------------
  // CRON scheduling — startCron()
  // ---------------------------------------------------------------------------

  /**
   * Registers a CRON-scheduled task. The task fires whenever the current time
   * matches the supplied 5-field cron expression. Internally a single shared
   * timer aligned to minute boundaries evaluates all CRON tasks.
   *
   * The `task` argument may be either:
   *  - a string script path (executed via the working service), or
   *  - an object describing the activity. If the object has a `scriptPath`
   *    property it is dispatched to the worker; otherwise it is recorded for
   *    inspection but not executed (the framework's working service does the
   *    actual dispatch in that case).
   *
   * @param {string|!Object} task The task definition.
   * @param {string} cron A standard 5-field cron expression.
   * @param {string=} taskName Optional explicit task name.
   * @param {Function=} callback Optional execution callback `(status, data)`.
   * @return {Promise<string>} The task name that was registered.
   * @throws {Error} On invalid arguments or duplicate task name.
   */
  async startCron(task, cron, taskName, callback) {
    if (task === undefined || task === null) {
      this.throwValidation_('startCron', 'Invalid task: must be a string or object', { taskName });
    }
    if (!isValid(cron)) {
      this.throwValidation_('startCron', `Invalid cron expression: "${cron}"`, { taskName, cron });
    }
    if (callback !== undefined && typeof callback !== 'function') {
      this.throwValidation_('startCron', 'Invalid callback: must be a function if provided', { taskName });
    }

    const name = taskName
      || (typeof task === 'object' && (task.name || task.type))
      || `task-${Date.now()}`;

    if (this.tasks_.has(name)) {
      throw new Error(`Task "${name}" is already scheduled`);
    }

    const parsedCron = parseCron(cron);
    const scriptPath = typeof task === 'string'
      ? task
      : (task.scriptPath || task.script || null);

    const record = {
      type: 'cron',
      name,
      task,
      scriptPath,
      data: typeof task === 'object' ? (task.data || null) : null,
      callback,
      cron,
      parsedCron,
      createdAt: new Date().toISOString(),
      lastFiredMinute: null,
      paused: false,
      description: typeof task === 'object' && typeof task.description === 'string' ? task.description : null,
      group: typeof task === 'object' && typeof task.group === 'string' ? task.group : null
    };

    this.tasks_.set(name, record);
    this.ensureCronTimerStarted_();

    analytics.trackScheduleStarted(name, cron, task);
    this.eventEmitter_?.emit('scheduler:started', {
      taskName: name,
      cron,
      task
    });
    this.logger?.info?.('[SchedulerProvider] CRON task registered', {
      taskName: name,
      cron,
      executable: !!scriptPath
    });

    return name;
  }

  /**
   * Lazily starts the shared cron evaluation timer.
   *
   * The timer re-aligns itself to the wall clock on every fire (a chained
   * `setTimeout`, not a `setInterval`). A repeating interval accumulates the
   * event loop's lag on every tick — a few milliseconds each time — until the
   * ticks slip past a whole minute boundary and that minute is never
   * evaluated. For a once-a-day expression like `0 1 * * *` a skipped minute
   * means the job does not run at all that day, so the drift matters.
   *
   * @private
   */
  ensureCronTimerStarted_() {
    if (this.cronTimer_ || this.shuttingDown_) return;

    const scheduleNext = () => {
      if (this.shuttingDown_) return;

      // Time until CRON_TICK_OFFSET_MS into the next minute, recomputed from
      // the clock each time so lag never accumulates.
      const now = Date.now();
      const thisTick = Math.floor((now - CRON_TICK_OFFSET_MS) / CRON_TICK_MS) * CRON_TICK_MS
        + CRON_TICK_OFFSET_MS;
      const nextTick = thisTick + CRON_TICK_MS;

      this.cronTimer_ = setTimeout(() => {
        this.cronTimer_ = null;
        try {
          this.evaluateCronTasks_(new Date());
        } catch (err) {
          this.logger?.error?.('[SchedulerProvider] Cron evaluation failed', {
            error: err?.message
          });
        }
        // A task registered during evaluation may have armed the timer
        // already; a second chain here would tick forever alongside it.
        if (this.cronTimer_) return;

        // Only keep ticking while cron tasks remain registered.
        for (const task of this.tasks_.values()) {
          if (task.type === 'cron') {
            scheduleNext();
            return;
          }
        }
      }, Math.max(1, nextTick - now));

      // Allow Node to exit if nothing else is keeping it alive.
      if (typeof this.cronTimer_.unref === 'function') {
        this.cronTimer_.unref();
      }
    };

    scheduleNext();
  }

  /**
   * Evaluates every registered CRON task and fires the matching ones.
   *
   * Every whole minute between the previous evaluation and `now` is checked,
   * not just the current one, so a tick that arrives late (event loop stall,
   * suspended host, coalesced timers) does not silently drop the minute a
   * schedule was waiting for. A task that matches more than one of the
   * replayed minutes fires ONCE — catching up means "you missed a run, here
   * it is", not "here are the twelve runs you missed".
   *
   * @param {!Date} now The current time.
   * @private
   */
  evaluateCronTasks_(now) {
    const minuteKey = this.floorToMinute_(now);

    // Already evaluated this minute (duplicate or early tick).
    if (this.lastCronTick_ !== null && minuteKey <= this.lastCronTick_) return;

    let from = this.lastCronTick_ === null
      ? minuteKey
      : this.lastCronTick_ + CRON_TICK_MS;

    const behindBy = (minuteKey - from) / CRON_TICK_MS;
    if (behindBy > CRON_MAX_CATCHUP_MINUTES) {
      from = minuteKey - (CRON_MAX_CATCHUP_MINUTES * CRON_TICK_MS);
      this.logger?.warn?.('[SchedulerProvider] Cron evaluation fell behind', {
        missedMinutes: Math.round(behindBy),
        replayedMinutes: CRON_MAX_CATCHUP_MINUTES
      });
    }

    this.lastCronTick_ = minuteKey;

    for (const task of this.tasks_.values()) {
      if (task.type !== 'cron' || task.paused) continue;

      for (let minute = from; minute <= minuteKey; minute += CRON_TICK_MS) {
        if (task.lastFiredMinute !== null && minute <= task.lastFiredMinute) continue;
        if (!matches(task.parsedCron, new Date(minute))) continue;

        task.lastFiredMinute = minuteKey;
        if (minute !== minuteKey) {
          this.logger?.warn?.('[SchedulerProvider] Running a missed CRON fire', {
            taskName: task.name,
            cron: task.cron,
            missedMinute: new Date(minute).toISOString()
          });
        }
        this.executeTask_(task);
        break; // At most one catch-up fire per evaluation.
      }
    }
  }

  /**
   * Rounds a date down to the start of its minute, as an epoch timestamp.
   * @param {!Date} date The date to floor.
   * @return {number} Epoch milliseconds at the start of that minute.
   * @private
   */
  floorToMinute_(date) {
    return Math.floor(date.getTime() / CRON_TICK_MS) * CRON_TICK_MS;
  }

  /**
   * Runs a registered task immediately, out of band of its schedule. The run
   * goes through the same concurrency, timeout, retry and callback machinery
   * as a scheduled fire, so callers observing the task see no difference.
   *
   * Used to replay a fire that was missed while the process was down.
   *
   * @param {string} taskName The task to run.
   * @return {Promise<boolean>} True if the task exists and was dispatched.
   */
  async runNow(taskName) {
    const task = this.tasks_.get(taskName);
    if (!task) return false;
    this.executeTask_(task, 'run-now');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Executes a single fire of a scheduled task, honouring concurrency,
   * timeout, and retry limits.
   *
   * @param {!Object} task The task record from `this.tasks_`.
   * @param {string=} trigger What started the run: 'schedule' or 'run-now'.
   * @private
   */
  executeTask_(task, trigger = 'schedule') {
    if (this.shuttingDown_) return;

    if (this.activeJobs_ >= this.settings.maxConcurrentJobs) {
      analytics.trackScheduleSkipped?.(task.name);
      this.eventEmitter_?.emit('scheduler:execution-skipped', {
        taskName: task.name,
        reason: 'maxConcurrentJobs',
        activeJobs: this.activeJobs_
      });
      this.logger?.warn?.('[SchedulerProvider] Skipped execution: at concurrency cap', {
        taskName: task.name,
        maxConcurrentJobs: this.settings.maxConcurrentJobs
      });
      this.recordRun_(task, {
        trigger,
        status: 'skipped',
        finishedAt: new Date().toISOString(),
        error: `Skipped: ${this.activeJobs_} jobs already running (maxConcurrentJobs)`
      });
      return;
    }

    // CRON tasks without an executable scriptPath are recorded but not run.
    if (task.type === 'cron' && !task.scriptPath) {
      analytics.trackScheduleRunning(task.name);
      analytics.trackScheduleCompleted(task.name);
      analytics.trackExecution(task.name, 'completed', { note: 'No scriptPath; recorded only.' });
      this.eventEmitter_?.emit('scheduler:taskExecuted', {
        taskName: task.name,
        cron: task.cron,
        status: 'recorded',
        data: null
      });
      this.recordRun_(task, { trigger, status: 'recorded', finishedAt: new Date().toISOString() });
      return;
    }

    if (!this.worker_ || typeof this.worker_.start !== 'function') {
      analytics.trackScheduleError(task.name);
      analytics.trackExecution(task.name, 'error', { error: 'No working service available' });
      this.eventEmitter_?.emit('scheduler:taskExecuted', {
        taskName: task.name,
        scriptPath: task.scriptPath,
        status: 'error',
        data: 'No working service available'
      });
      this.recordRun_(task, {
        trigger,
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: 'No working service available'
      });
      this.applyOutcome_(task, 'error', 'No working service available', 0);
      return;
    }

    this.activeJobs_++;
    task.activeRuns = (task.activeRuns || 0) + 1;
    task.lastStartedAt = new Date().toISOString();
    analytics.trackScheduleRunning(task.name);
    analytics.trackExecution(task.name, 'running');

    const startedAt = Date.now();
    const run = this.recordRun_(task, { trigger, status: 'running' });
    let settled = false;
    let timeoutHandle = null;
    let attempts = 0;
    const maxAttempts = 1 + this.settings.retryAttempts;

    const finish = (status, data) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.activeJobs_ = Math.max(0, this.activeJobs_ - 1);
      task.activeRuns = Math.max(0, (task.activeRuns || 1) - 1);
      task.lastFinishedAt = new Date().toISOString();

      const durationMs = Date.now() - startedAt;
      const normalised = (status === 'completed' || status === 'success') ? 'completed' : 'error';

      run.status = normalised;
      run.finishedAt = task.lastFinishedAt;
      run.durationMs = durationMs;
      run.attempts = attempts;
      if (normalised === 'completed') {
        run.result = data === undefined ? null : data;
      } else {
        run.error = this.errorText_(data);
      }
      this.applyOutcome_(task, normalised, data, durationMs);

      if (normalised === 'completed') {
        analytics.trackScheduleCompleted(task.name);
        analytics.trackExecution(task.name, 'completed', { data, durationMs });
      } else {
        analytics.trackScheduleError(task.name);
        analytics.trackExecution(task.name, 'error', { data, durationMs });
      }

      this.eventEmitter_?.emit('scheduler:taskExecuted', {
        taskName: task.name,
        scriptPath: task.scriptPath,
        status: normalised,
        data,
        durationMs,
        attempts
      });

      if (task.callback) {
        try {
          task.callback(normalised, data);
        } catch (err) {
          this.logger?.error?.('[SchedulerProvider] Task callback threw', {
            taskName: task.name,
            error: err?.message
          });
        }
      }
    };

    const tryOnce = () => {
      attempts++;
      let attemptDone = false;

      const onAttemptResult = (status, data) => {
        if (attemptDone || settled) return;
        attemptDone = true;
        const ok = status === 'completed' || status === 'success';

        if (ok) {
          finish('completed', data);
          return;
        }

        if (attempts < maxAttempts && !this.shuttingDown_) {
          this.logger?.warn?.('[SchedulerProvider] Execution failed, retrying', {
            taskName: task.name,
            attempt: attempts,
            maxAttempts
          });
          // Schedule the retry on the next tick to avoid recursive stack growth.
          setImmediate(tryOnce);
          return;
        }

        finish('error', data);
      };

      try {
        this.worker_.start(task.scriptPath, task.data, onAttemptResult);
      } catch (err) {
        onAttemptResult('error', err?.message || String(err));
      }
    };

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      this.logger?.error?.('[SchedulerProvider] Execution exceeded jobTimeout', {
        taskName: task.name,
        jobTimeout: this.settings.jobTimeout
      });
      finish('error', `Job exceeded jobTimeout (${this.settings.jobTimeout}ms)`);
    }, this.settings.jobTimeout);
    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

    tryOnce();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle — stop / cancel / isRunning / list / get
  // ---------------------------------------------------------------------------

  /**
   * Cancels a single scheduled task by name. Equivalent to `stop(taskId)` and
   * preserved for backwards compatibility with earlier API consumers.
   *
   * @param {string} taskId The task name to cancel.
   * @return {Promise<boolean>} True if a task was removed.
   */
  async cancel(taskId) {
    if (!this.tasks_.has(taskId)) return false;
    const task = this.tasks_.get(taskId);
    if (task.intervalId) clearInterval(task.intervalId);
    this.tasks_.delete(taskId);
    this.runs_.delete(taskId);
    analytics.trackScheduleStopped(taskId);
    this.eventEmitter_?.emit('scheduler:stopped', { taskName: taskId });
    this.maybeStopCronTimer_();
    return true;
  }

  /**
   * Stops a specific task or, if no name is given, every task. Unlike the
   * previous implementation this does NOT stop the shared working service —
   * the working service is owned by the registry and may be in use by other
   * subsystems.
   *
   * @param {string=} taskName Optional task name.
   * @return {Promise<void>}
   */
  async stop(taskName) {
    if (taskName !== undefined) {
      if (!taskName || typeof taskName !== 'string' || taskName.trim() === '') {
        this.throwValidation_('stop', 'Invalid taskName: must be a non-empty string if provided', { taskName });
      }
      if (this.tasks_.has(taskName)) {
        const task = this.tasks_.get(taskName);
        if (task.intervalId) clearInterval(task.intervalId);
        this.tasks_.delete(taskName);
        this.runs_.delete(taskName);
        analytics.trackScheduleStopped(taskName);
        this.eventEmitter_?.emit('scheduler:stopped', { taskName });
      }
      this.maybeStopCronTimer_();
      return;
    }

    for (const [name, task] of this.tasks_.entries()) {
      if (task.intervalId) clearInterval(task.intervalId);
      analytics.trackScheduleStopped(name);
      this.eventEmitter_?.emit('scheduler:stopped', { taskName: name });
    }
    this.tasks_.clear();
    this.runs_.clear();
    this.maybeStopCronTimer_();
  }

  /**
   * Stops the cron evaluation timer if there are no remaining cron tasks.
   * @private
   */
  maybeStopCronTimer_() {
    if (!this.cronTimer_) return;
    for (const task of this.tasks_.values()) {
      if (task.type === 'cron') return;
    }
    clearTimeout(this.cronTimer_);
    this.cronTimer_ = null;
    this.lastCronTick_ = null;
  }

  /**
   * Reports whether a specific task or any task is currently registered.
   *
   * @param {string=} taskName Optional task name.
   * @return {Promise<boolean>}
   */
  async isRunning(taskName) {
    if (taskName) return this.tasks_.has(taskName);
    return this.tasks_.size > 0;
  }

  /**
   * Returns a snapshot of all currently registered schedules. Internal
   * fields like timer handles and parsed cron sets are stripped from the
   * output to keep it serialisable.
   *
   * @return {Promise<!Array<!Object>>}
   */
  async listSchedules() {
    const out = [];
    for (const task of this.tasks_.values()) {
      out.push(this.summariseTask_(task));
    }
    return out;
  }

  /**
   * Returns a single schedule by name, or null if not found.
   *
   * @param {string} taskName The schedule name.
   * @return {Promise<?Object>}
   */
  async getSchedule(taskName) {
    if (!this.tasks_.has(taskName)) return null;
    return this.summariseTask_(this.tasks_.get(taskName));
  }

  /**
   * Builds a serialisable summary of a task record.
   * @param {!Object} task The internal task record.
   * @return {!Object}
   * @private
   */
  summariseTask_(task) {
    const summary = {
      name: task.name,
      type: task.type,
      createdAt: task.createdAt,
      scriptPath: task.scriptPath || null,
      // Execution state — lets callers tell "a run is in flight" apart from
      // "this schedule is overdue and nothing is happening".
      activeRuns: task.activeRuns || 0,
      lastStartedAt: task.lastStartedAt || null,
      lastFinishedAt: task.lastFinishedAt || null
    };
    if (task.type === 'interval') {
      summary.intervalSeconds = task.intervalSeconds;
    } else if (task.type === 'cron') {
      summary.cron = task.cron;
      summary.lastFiredMinute = task.lastFiredMinute;
    }
    // Management view: the task's own outcome bookkeeping and plan.
    summary.enabled = !task.paused;
    summary.running = (task.activeRuns || 0) > 0;
    summary.nextRun = this.nextRunFor_(task);
    summary.lastResult = task.lastResult || null;
    summary.lastError = task.lastError || null;
    summary.lastDurationMs = task.lastDurationMs ?? null;
    summary.executionCount = task.executionCount || 0;
    summary.data = task.data ?? null;
    summary.description = task.description || null;
    summary.group = task.group || null;
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Management — pause / resume / update / run history
  // ---------------------------------------------------------------------------

  /**
   * Builds the timer callback for an interval task. Paused tasks keep their
   * timer (so resuming keeps the original cadence) but skip the run.
   * @param {!Object} task The interval task record.
   * @return {function()} The timer callback.
   * @private
   */
  intervalFire_(task) {
    return () => {
      task.lastTickAt = Date.now();
      if (task.paused) return;
      this.executeTask_(task, 'schedule');
    };
  }

  /**
   * Calculates when a task will next fire.
   * @param {!Object} task The task record.
   * @return {?string} ISO timestamp, or null when paused or never firing.
   * @private
   */
  nextRunFor_(task) {
    if (task.paused) return null;
    if (task.type === 'cron') {
      const next = task.parsedCron ? nextMatch(task.parsedCron) : null;
      return next ? next.toISOString() : null;
    }
    if (task.type === 'interval') {
      const base = task.lastTickAt || Date.parse(task.createdAt) || Date.now();
      return new Date(base + task.intervalSeconds * 1000).toISOString();
    }
    return null;
  }

  /**
   * Turns a worker failure payload into a readable message.
   * @param {*} data Failure payload.
   * @return {string} Error text.
   * @private
   */
  errorText_(data) {
    if (data === undefined || data === null || data === '') return 'Execution failed';
    if (typeof data === 'string') return data;
    if (data instanceof Error) return data.message;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    try {
      return JSON.stringify(data);
    } catch (_err) {
      return String(data);
    }
  }

  /**
   * Stamps a finished run's outcome on its task.
   * @param {!Object} task The task record.
   * @param {string} status 'completed' or 'error'.
   * @param {*} data Result or failure payload.
   * @param {number} durationMs Run duration.
   * @private
   */
  applyOutcome_(task, status, data, durationMs) {
    task.lastResult = status === 'completed' ? 'success' : 'failed';
    task.lastError = status === 'completed' ? null : this.errorText_(data);
    task.lastDurationMs = durationMs;
    task.executionCount = (task.executionCount || 0) + 1;
  }

  /**
   * Adds a run to a task's history (newest first, capped).
   * @param {!Object} task The task record.
   * @param {!Object} fields Initial run fields.
   * @return {!Object} The live run record (mutated as the run progresses).
   * @private
   */
  recordRun_(task, fields) {
    const run = {
      executionId: `run-${Date.now().toString(36)}-${(++this.runSeq_).toString(36)}`,
      taskName: task.name,
      trigger: 'schedule',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      attempts: 0,
      error: null,
      ...fields
    };
    if (!this.runs_.has(task.name)) this.runs_.set(task.name, []);
    const list = this.runs_.get(task.name);
    list.unshift(run);
    if (list.length > this.maxRunsPerTask_) list.length = this.maxRunsPerTask_;
    return run;
  }

  /**
   * Pauses a task: its schedule keeps ticking but no runs start until it is
   * resumed. A run already in flight finishes normally.
   *
   * @param {string} taskName The task to pause.
   * @return {Promise<boolean>} True if the task exists.
   */
  async pause(taskName) {
    const task = this.tasks_.get(taskName);
    if (!task) return false;
    if (!task.paused) {
      task.paused = true;
      this.eventEmitter_?.emit('scheduler:paused', { taskName });
      this.logger?.info?.('[SchedulerProvider] Task paused', { taskName });
    }
    return true;
  }

  /**
   * Resumes a paused task. It fires at its next scheduled time; missed fires
   * while paused are not replayed.
   *
   * @param {string} taskName The task to resume.
   * @return {Promise<boolean>} True if the task exists.
   */
  async resume(taskName) {
    const task = this.tasks_.get(taskName);
    if (!task) return false;
    if (task.paused) {
      task.paused = false;
      if (task.type === 'cron') {
        // Don't treat the minutes spent paused as missed fires.
        task.lastFiredMinute = this.floorToMinute_(new Date());
      }
      this.eventEmitter_?.emit('scheduler:resumed', { taskName });
      this.logger?.info?.('[SchedulerProvider] Task resumed', { taskName });
    }
    return true;
  }

  /**
   * Changes a task in place, keeping its name, execution callback and run
   * history. Everything is validated before anything changes. Giving `cron`
   * to an interval task (or `intervalSeconds` to a cron task) switches its
   * type.
   *
   * @param {string} taskName The task to change.
   * @param {!Object} changes The changes.
   * @param {string=} changes.cron New 5-field cron expression.
   * @param {number=} changes.intervalSeconds New interval in seconds.
   * @param {string=} changes.scriptPath New activity script path.
   * @param {*=} changes.data New data payload passed to each run.
   * @param {?string=} changes.description Free-text description.
   * @param {?string=} changes.group Group the task is listed under.
   * @return {Promise<?Object>} The updated summary, or null if not found.
   * @throws {Error} On invalid changes.
   */
  async update(taskName, changes = {}) {
    const task = this.tasks_.get(taskName);
    if (!task) return null;
    if (!changes || typeof changes !== 'object') {
      this.throwValidation_('update', 'Invalid changes: must be an object', { taskName });
    }
    const hasCron = changes.cron !== undefined && changes.cron !== null;
    const hasInterval = changes.intervalSeconds !== undefined && changes.intervalSeconds !== null;
    if (hasCron && hasInterval) {
      this.throwValidation_('update', 'Give either cron or intervalSeconds, not both', { taskName });
    }
    if (hasCron && !isValid(changes.cron)) {
      this.throwValidation_('update', `Invalid cron expression: "${changes.cron}"`, { taskName, cron: changes.cron });
    }
    if (hasInterval) {
      const n = Number(changes.intervalSeconds);
      if (!Number.isFinite(n) || n < MIN_INTERVAL_SECONDS) {
        this.throwValidation_('update', 'Invalid interval: must be a positive number of seconds', { taskName });
      }
    }
    if (changes.scriptPath !== undefined) this.assertScriptPath_(changes.scriptPath, taskName);

    if (hasCron) {
      if (task.intervalId) clearInterval(task.intervalId);
      task.intervalId = null;
      delete task.intervalSeconds;
      task.type = 'cron';
      task.cron = changes.cron.trim();
      task.parsedCron = parseCron(task.cron);
      // Start from this minute so a change never fires a run on its own.
      task.lastFiredMinute = this.floorToMinute_(new Date());
      this.ensureCronTimerStarted_();
    } else if (hasInterval) {
      if (task.intervalId) clearInterval(task.intervalId);
      task.type = 'interval';
      delete task.cron;
      delete task.parsedCron;
      task.intervalSeconds = Number(changes.intervalSeconds);
      task.lastTickAt = Date.now();
      task.intervalId = setInterval(this.intervalFire_(task), task.intervalSeconds * 1000);
      this.maybeStopCronTimer_();
    }
    if (changes.scriptPath !== undefined) task.scriptPath = changes.scriptPath;
    if (changes.data !== undefined) task.data = changes.data;
    if (changes.description !== undefined) task.description = changes.description || null;
    if (changes.group !== undefined) task.group = changes.group || null;

    this.eventEmitter_?.emit('scheduler:updated', { taskName, changes: Object.keys(changes) });
    this.logger?.info?.('[SchedulerProvider] Task updated', { taskName, changes: Object.keys(changes) });
    return this.summariseTask_(task);
  }

  /**
   * Returns recent runs, newest first, for one task or all tasks.
   *
   * @param {Object=} options Query options.
   * @param {string=} options.taskName Only this task's runs.
   * @param {string=} options.status 'success' | 'failed' | 'running' | 'skipped',
   *   or a raw run status.
   * @param {number=} options.limit Maximum runs returned (default 100).
   * @param {boolean=} options.includeResult Include each run's result payload.
   * @return {Promise<{runs: !Array<!Object>, total: number}>}
   */
  async listRuns(options = {}) {
    const bucket = { success: 'completed', failed: 'error' };
    const wanted = options.status ? (bucket[options.status] || options.status) : null;
    let runs = [];
    if (options.taskName) {
      runs = (this.runs_.get(options.taskName) || []).slice();
    } else {
      for (const list of this.runs_.values()) runs = runs.concat(list);
      runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    }
    if (wanted) runs = runs.filter(r => r.status === wanted);
    const total = runs.length;
    const limit = options.limit > 0 ? options.limit : 100;
    runs = runs.slice(0, limit).map((r) => {
      if (options.includeResult) return { ...r };
      const { result, ...rest } = r;
      return { ...rest, hasResult: result !== undefined && result !== null };
    });
    return { runs, total };
  }

  /**
   * Returns one run with its result payload.
   * @param {string} executionId The run id.
   * @return {Promise<?Object>} The run, or null.
   */
  async getRun(executionId) {
    for (const list of this.runs_.values()) {
      const run = list.find(r => r.executionId === executionId);
      if (run) return { ...run };
    }
    return null;
  }

  /**
   * Summary counts across tasks and their remembered runs.
   * @return {Promise<!Object>}
   */
  async getStats() {
    const tasks = Array.from(this.tasks_.values());
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    for (const list of this.runs_.values()) {
      for (const r of list) {
        if (r.status === 'completed') succeeded++;
        else if (r.status === 'error') failed++;
        else if (r.status === 'skipped') skipped++;
      }
    }
    return {
      total: tasks.length,
      enabled: tasks.filter(t => !t.paused).length,
      paused: tasks.filter(t => t.paused).length,
      running: tasks.filter(t => (t.activeRuns || 0) > 0).length,
      failing: tasks.filter(t => t.lastResult === 'failed').length,
      totalExecutions: tasks.reduce((sum, t) => sum + (t.executionCount || 0), 0),
      activeJobs: this.activeJobs_,
      maxConcurrentJobs: this.settings.maxConcurrentJobs,
      runs: { succeeded, failed, skipped },
      byType: {
        cron: tasks.filter(t => t.type === 'cron').length,
        interval: tasks.filter(t => t.type === 'interval').length
      }
    };
  }

  /**
   * Gracefully shuts down the scheduler, releasing all timers. Intended for
   * use in test teardown and process exit handlers; the scheduler is not
   * usable after shutdown.
   *
   * @return {Promise<void>}
   */
  async shutdown() {
    this.shuttingDown_ = true;
    await this.stop();
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {*} taskName Candidate task name.
   * @param {string} method Calling method, used for diagnostics.
   * @private
   */
  assertTaskName_(taskName, method) {
    if (!taskName || typeof taskName !== 'string' || taskName.trim() === '') {
      this.throwValidation_(method, 'Invalid taskName: must be a non-empty string', { taskName });
    }
  }

  /**
   * @param {*} scriptPath Candidate script path.
   * @param {string} taskName Task name being validated against.
   * @private
   */
  assertScriptPath_(scriptPath, taskName) {
    if (!scriptPath || typeof scriptPath !== 'string' || scriptPath.trim() === '') {
      this.throwValidation_('start', 'Invalid scriptPath: must be a non-empty string', { taskName, scriptPath });
    }
    // Reject paths the working service would refuse at fire time (absolute,
    // wrong extension) so the error surfaces when the task is created (feature 18).
    try {
      this.worker_?.validateActivityPath?.(scriptPath);
    } catch (err) {
      this.throwValidation_('start', `Invalid scriptPath: ${err.message}`, { taskName, scriptPath });
    }
  }

  /**
   * Emits a validation error event and throws.
   * @param {string} method Calling method.
   * @param {string} message Error message.
   * @param {!Object} context Extra context for the event payload.
   * @private
   */
  throwValidation_(method, message, context) {
    const error = new Error(message);
    this.eventEmitter_?.emit('scheduler:validation-error', {
      method,
      error: message,
      ...context
    });
    throw error;
  }
}

module.exports = SchedulerProvider;
