/**
 * @fileoverview Production worker manager.
 *
 * Owns a pool of `worker_threads` Workers and dispatches queued tasks to
 * them. Tasks are persisted in three named queues from the injected queueing
 * service so the lifecycle is observable from outside the process:
 *
 *   - `nooblyjs-core-working-incoming` — tasks waiting to start
 *   - `nooblyjs-core-working-complete` — finished successfully
 *   - `nooblyjs-core-working-error`    — finished in error
 *
 * Behaviour is governed by three settings, each enforced at runtime:
 *
 *   - `workerTimeout` — wall-clock budget per task in ms; an exceeded task is
 *     terminated, recorded as an error, and the worker slot freed.
 *   - `maxQueueSize`  — refuses new `start()` calls when the incoming queue
 *     is at the cap, returning a structured error rather than silently
 *     growing memory.
 *   - `enableLogging` — gates the structured logger calls so high-volume
 *     deployments can opt out of per-task log lines.
 *
 * The queue processor is a 1-second interval that is `unref()`'d so it does
 * not keep the Node event loop alive on its own — long-running services
 * still tick, but unit tests and short-lived scripts exit cleanly.
 *
 * COMPLETION IS CORRELATED BY TASK ID, NOT CARRIED ON THE QUEUE. Everything
 * enqueued here must survive a JSON round trip, because the queueing service may
 * be out of process: the ActiveMQ provider enqueues with `JSON.stringify` and
 * dequeues with `JSON.parse`. A caller's `completionCallback` is therefore kept
 * in `pendingCallbacks_` on the process that called `start()`, and the task
 * carries only an `origin` stamp naming that process. Two paths settle it:
 *
 *   - LOCAL — the process that queued the task also ran it (always so for the
 *     in-memory provider). `finaliseTask_` fires the callback directly, with no
 *     broker round trip.
 *   - REMOTE — another process ran it and wrote the result to the shared
 *     complete/error queue. `processResults_` drains those queues and matches
 *     results to the waiters this process holds; results belonging to a sibling
 *     are put back for it, up to `MAX_RESULT_ROUTING_ATTEMPTS`.
 *
 * Every waiter has a deadline (`callbackTimeout`), so a task whose result never
 * arrives fails loudly instead of leaving the caller awaiting a promise that can
 * never settle. This matters because the callback is the ONLY way a workflow
 * step advances — `WorkflowService` awaits a promise that resolves nowhere else.
 * Before this, putting the function on the queue meant it was silently dropped
 * by JSON and every workflow hung after its first step.
 *
 * @author NooblyJS Core Team
 * @version 2.1.0
 * @since 1.0.0
 */

'use strict';

const { Worker } = require('worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { resolveActivityScript, registerActivitiesRoot } = require('../modules/activityPath');

/** @const {number} Queue processor poll interval in ms. */
const QUEUE_TICK_MS = 1000;

/** @const {number} Max task history entries kept in memory. */
const TASK_HISTORY_LIMIT = 1000;

/**
 * @const {number} How many times a result belonging to another process may be
 * put back on the shared result queue before it is dropped. Bounds the case
 * where the owning process has gone away permanently — without it the message
 * would circulate between the surviving consumers forever.
 */
const MAX_RESULT_ROUTING_ATTEMPTS = 10;

/**
 * @const {number} Grace period added to `workerTimeout` to derive the default
 * deadline for a waiting callback. A waiter must outlive the work it is waiting
 * for, or a slow-but-successful task would settle as a timeout.
 */
const CALLBACK_TIMEOUT_GRACE_MS = 60000;

/**
 * Production-grade worker manager.
 *
 * @class
 */
class WorkerManager {
  /**
   * @param {Object=} options Configuration options.
   * @param {number=} options.maxThreads Max concurrent worker threads (default 4).
   * @param {number=} options.workerTimeout Per-task timeout in ms (default 300000).
   * @param {number=} options.maxQueueSize Max incoming queue depth (default 1000).
   * @param {boolean=} options.enableLogging Whether to emit per-task logs (default true).
   * @param {string=} options.activitiesFolder Folder for relative script paths.
   * @param {Object=} options.dependencies Injected service dependencies.
   * @param {Object=} options.dependencies.queueing Queueing service (required).
   * @param {Object=} options.dependencies.filing Filing service (optional).
   * @param {EventEmitter=} eventEmitter Optional event emitter.
   */
  constructor(options = {}, eventEmitter) {
    /** @private @const {?EventEmitter} */
    this.eventEmitter_ = eventEmitter || null;

    /** @private {?Object} Logger injected by the factory. */
    this.logger = null;

    // Settings configuration. Field metadata is exposed via getSettings()
    // for use by the settings UI; the actual values live alongside it.
    this.settings = {
      description: 'Configuration settings for the working service',
      list: [
        { setting: 'workerTimeout', type: 'number',  values: null },
        { setting: 'maxQueueSize',  type: 'number',  values: null },
        { setting: 'enableLogging', type: 'boolean', values: null }
      ],
      workerTimeout: this.coerceNumber_(options.workerTimeout, 120000000, 1000),
      maxQueueSize:  this.coerceNumber_(options.maxQueueSize,  1000,   1),
      enableLogging: options.enableLogging !== undefined ? !!options.enableLogging : true,
      callbackTimeout: 0 // resolved just below, once workerTimeout is known
    };
    this.settings.list.push({ setting: 'callbackTimeout', type: 'number', values: null });
    this.settings.callbackTimeout = this.coerceNumber_(
      options.callbackTimeout,
      this.settings.workerTimeout + CALLBACK_TIMEOUT_GRACE_MS,
      1000
    );

    /**
     * Identifies THIS manager instance among every process sharing the queueing
     * backend. Stamped on each task and carried onto its result, so a result
     * dequeued from the shared result queue can be told apart from one belonging
     * to a sibling process. Override via `options.originId` to pin it across
     * restarts (a restarted process does not inherit the previous one's waiters,
     * so a stable id mainly aids log correlation).
     * @private @const {string}
     */
    this.originId_ = options.originId
      || `${os.hostname()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

    /**
     * Callbacks awaiting a result, keyed by task id: `{callback, expiresAt, scriptPath}`.
     *
     * THE CALLBACK NEVER GOES ON THE QUEUE. It used to be a property of the
     * enqueued task, which works only while the queue hands back the very same
     * object — true of the in-memory provider, false of every out-of-process one:
     * ActiveMQ enqueues with `JSON.stringify` and dequeues with `JSON.parse`, and
     * JSON silently drops function-valued properties. The task then completed
     * with `task.completionCallback` undefined, so nothing ever settled the
     * promise WorkflowService awaits — every workflow hung after its first step
     * with no error logged anywhere.
     * @private @const {!Map<string, !Object>}
     */
    this.pendingCallbacks_ = new Map();

    /** @private @const {number} Maximum concurrent worker threads. */
    this.maxThreads_ = this.coerceNumber_(options.maxThreads, 4, 1);

    /** @private @const {!Map<string, !Object>} */
    this.activeWorkers_ = new Map();

    /** @private @const {!Map<string, !Object>} */
    this.taskHistory_ = new Map();

    /** @private {boolean} Manager running state. */
    this.isRunning_ = true;

    /** @private {?Object} Queueing service instance. */
    this.queueService_ = options.dependencies?.queueing || null;

    /** @private {?Object} Filing service instance. */
    this.filingService_ = options.dependencies?.filing || null;

    /** @private @const {string} Activities folder path. */
    this.activitiesFolder_ =
      options.activitiesFolder ||
      options['nooblyjs-core-activities'] ||
      'activities';

    // Feature 18: the activities folder must not overlap a filing store, or an
    // uploaded file could be run as code. Fails construction when it does.
    registerActivitiesRoot(path.resolve(process.cwd(), this.activitiesFolder_));

    /**
     * Named activities (name → script path). When set, HTTP callers must pass
     * a registered name; the path never crosses the API.
     * @private @const {?Object<string, string>}
     */
    this.activityRegistry_ = options.activities && typeof options.activities === 'object'
      ? { ...options.activities }
      : null;

    /** @private @const {!Array<string>} Extra roots absolute paths may use. */
    this.trustedRoots_ = Array.isArray(options.trustedRoots) ? options.trustedRoots.slice() : [];

    /**
     * Deprecated escape hatch: run absolute paths anywhere outside filing
     * stores. Logged once when used.
     * @private @const {boolean}
     */
    this.allowAbsolutePaths_ = options.allowAbsolutePaths === true;
    this.warnedAbsolute_ = false;

    /** @private @const {!Object} Worker thread resource limits. */
    this.workerResourceLimits_ = {
      maxOldGenerationSizeMb: Number(options.workerMaxHeapMb) > 0 ? Number(options.workerMaxHeapMb) : 512,
      stackSizeMb: Number(options.workerStackSizeMb) > 0 ? Number(options.workerStackSizeMb) : 4
    };

    /** @private {?NodeJS.Timeout} Queue processing interval. */
    this.queueProcessorInterval_ = null;

    /** @private {boolean} Whether a queue-processor pass is still running (see startQueueProcessor_). */
    this.tickInFlight_ = false;

    /** @private {number} Ticks dropped because the previous pass had not finished. */
    this.skippedTicks_ = 0;

    /** @private @const {string} Queue name for incoming tasks. */
    this.QUEUE_INCOMING_ = 'nooblyjs-core-working-incoming';
    /** @private @const {string} Queue name for completed tasks. */
    this.QUEUE_COMPLETE_ = 'nooblyjs-core-working-complete';
    /** @private @const {string} Queue name for error tasks. */
    this.QUEUE_ERROR_ = 'nooblyjs-core-working-error';

    if (!this.queueService_) {
      // Don't throw — the factory may attach the dependency after construction
      // in some legacy code paths. Log instead and let start() raise the error
      // when actually invoked.
      this.logger?.warn?.(`[${this.constructor.name}] Queueing service not provided; start() will fail until one is supplied`);
    }

    this.startQueueProcessor_();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /**
   * Coerces a value to a positive number with a fallback. Used so that
   * settings posted as strings still produce valid numeric configuration.
   *
   * @private
   * @param {*} value
   * @param {number} fallback
   * @param {number=} min Minimum acceptable value (defaults to 0).
   * @return {number}
   */
  coerceNumber_(value, fallback, min = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? n : fallback;
  }

  /**
   * Returns the current settings object (with metadata).
   * @return {Promise<!Object>}
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Applies a partial settings update. Unknown keys are ignored. Each
   * accepted setting emits a `worker:setting-changed` event so observers
   * (e.g. the analytics module or external dashboards) can react.
   *
   * @param {!Object} updates
   * @return {Promise<void>}
   */
  async saveSettings(updates) {
    if (!updates || typeof updates !== 'object') return;

    for (const { setting, type } of this.settings.list) {
      if (updates[setting] == null) continue;

      let value = updates[setting];
      if (type === 'number') {
        value = this.coerceNumber_(value, this.settings[setting], 0);
      } else if (type === 'boolean') {
        value = !!value;
      }

      this.settings[setting] = value;
      this.logIf_('info', 'Setting changed', { setting, value });
      this.eventEmitter_?.emit('worker:setting-changed', { setting, value });
    }
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /**
   * Routes a log line through the injected logger if logging is enabled.
   * Falls silent if either condition is false.
   *
   * @private
   * @param {string} level
   * @param {string} message
   * @param {Object=} meta
   */
  logIf_(level, message, meta = {}) {
    if (!this.settings.enableLogging) return;
    this.logger?.[level]?.(`[${this.constructor.name}] ${message}`, meta);
  }

  // ---------------------------------------------------------------------------
  // Task lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Generates a unique task ID. Hex is used so the ID is URL-safe and easy
   * to log.
   * @private
   * @return {string}
   */
  generateTaskId_() {
    return crypto.randomBytes(16).toString('hex');
  }

  // ---------------------------------------------------------------------------
  // Completion waiters
  //
  // A caller's completionCallback stays in THIS process, keyed by task id, while
  // only serialisable data goes on the queue. Two things then settle it:
  //
  //   1. the local fast path — when this process both queued and executed the
  //      task (always true for an in-process queue, and the common case for a
  //      single deployment), finaliseTask_ settles it directly, with no broker
  //      round trip and identical latency to the previous behaviour;
  //   2. the results consumer — when another process executed it, that process
  //      writes the result to the shared result queue, and processResults_ here
  //      correlates it back by task id.
  // ---------------------------------------------------------------------------

  /**
   * Records a callback to be fired when `taskId` finishes, wherever it runs.
   * No-ops when no callback was supplied, so `start()` stays allocation-free
   * for fire-and-forget callers.
   *
   * @private
   * @param {string} taskId
   * @param {Function|undefined} callback
   * @param {string} scriptPath Retained for the timeout message and logs.
   */
  registerWaiter_(taskId, callback, scriptPath) {
    if (typeof callback !== 'function') return;
    this.pendingCallbacks_.set(taskId, {
      callback,
      scriptPath,
      expiresAt: Date.now() + this.settings.callbackTimeout
    });
  }

  /**
   * Fires and removes the waiter for `taskId`, if this process holds one.
   *
   * @private
   * @param {string} taskId
   * @param {string} status `'completed'` or `'error'`.
   * @param {*} data Result payload, or error message.
   * @return {boolean} Whether a waiter was found and fired.
   */
  settleWaiter_(taskId, status, data) {
    const waiter = this.pendingCallbacks_.get(taskId);
    if (!waiter) return false;

    this.pendingCallbacks_.delete(taskId);
    try {
      waiter.callback(status, data);
    } catch (err) {
      this.eventEmitter_?.emit('worker:callback:error', { taskId, error: err.message });
      this.logIf_('error', 'Completion callback threw', { taskId, error: err.message });
    }
    return true;
  }

  /**
   * Fails any waiter whose result never arrived.
   *
   * Without this, moving the callback off the queue would merely relocate the
   * hang it was introduced to fix: a task lost because the process that claimed
   * it died mid-flight leaves a caller awaiting a promise that can never settle.
   * The deadline is `callbackTimeout` (workerTimeout + a grace period by
   * default), so a slow-but-successful task is never cut short.
   *
   * @private
   */
  sweepExpiredWaiters_() {
    if (this.pendingCallbacks_.size === 0) return;

    const now = Date.now();
    for (const [taskId, waiter] of this.pendingCallbacks_) {
      if (waiter.expiresAt > now) continue;

      this.pendingCallbacks_.delete(taskId);
      const message =
        `No result received for task ${taskId} within ${this.settings.callbackTimeout}ms`;

      this.eventEmitter_?.emit('worker:callback:timeout', {
        taskId,
        scriptPath: waiter.scriptPath,
        timeoutMs: this.settings.callbackTimeout
      });
      this.logIf_('error', 'Completion callback timed out', {
        taskId,
        scriptPath: waiter.scriptPath,
        timeoutMs: this.settings.callbackTimeout
      });

      try {
        waiter.callback('error', message);
      } catch (_) { /* swallow — the caller's own handler failed */ }
    }
  }

  /**
   * Drains the shared result queues and settles the waiters this process owns.
   *
   * Results are written by whichever process EXECUTED the task, so on a shared
   * broker a process routinely dequeues results belonging to its siblings. Those
   * are put straight back, and draining stops for this tick so the message is
   * not immediately re-read in a tight loop; `routingAttempts` bounds the
   * recycling so a result whose owner has gone for good is eventually dropped
   * rather than circulating forever.
   *
   * A result of our own with no waiter is normal, not an error: the local fast
   * path in finaliseTask_ already settled it, and this pass is what stops the
   * queue growing without bound.
   *
   * @private
   * @return {Promise<void>}
   */
  async processResults_() {
    if (!this.queueService_ || !this.isRunning_) return;

    for (const queueName of [this.QUEUE_COMPLETE_, this.QUEUE_ERROR_]) {
      // Ask for the size first: dequeue on an empty queue waits out the
      // provider's full dequeue timeout, which would otherwise be paid on
      // every tick of an idle system.
      let queueSize = 0;
      try {
        queueSize = await this.queueService_.size(queueName);
      } catch (_) {
        continue; // transient backend trouble; try again next tick
      }

      while (queueSize > 0) {
        const result = await this.queueService_.dequeue(queueName);
        if (!result) break;
        queueSize--;

        const taskId = result.taskId;
        const isOurs = !result.origin || result.origin === this.originId_;

        if (isOurs) {
          // Settles a task another process ran on our behalf; a no-op when the
          // local fast path already fired, which is the single-process norm.
          this.settleWaiter_(taskId, result.status, this.resultPayload_(result));
          continue;
        }

        if (this.pendingCallbacks_.has(taskId)) {
          // Ours after all — the origin stamp says otherwise, but the waiter is
          // the authoritative claim.
          this.settleWaiter_(taskId, result.status, this.resultPayload_(result));
          continue;
        }

        await this.recycleForeignResult_(queueName, result);
        break; // let the owner have a turn before we read this queue again
      }
    }
  }

  /**
   * Extracts the value a completion callback should receive from a task result.
   * Mirrors how finaliseTask_ splits `result` and `error` across the two fields.
   *
   * @private
   * @param {!Object} taskResult
   * @return {*}
   */
  resultPayload_(taskResult) {
    return taskResult.status === 'completed' ? taskResult.result : taskResult.error;
  }

  /**
   * Puts a sibling process's result back on its queue so the owner can claim it,
   * dropping it once it has been passed over too many times.
   *
   * @private
   * @param {string} queueName
   * @param {!Object} result
   * @return {Promise<void>}
   */
  async recycleForeignResult_(queueName, result) {
    const attempts = (result.routingAttempts || 0) + 1;

    if (attempts > MAX_RESULT_ROUTING_ATTEMPTS) {
      this.eventEmitter_?.emit('worker:result:orphaned', {
        taskId: result.taskId,
        origin: result.origin,
        attempts
      });
      this.logIf_('warn', 'Dropped orphaned task result', {
        taskId: result.taskId,
        origin: result.origin,
        attempts,
        reason: `no process claimed it within ${MAX_RESULT_ROUTING_ATTEMPTS} passes`
      });
      return;
    }

    try {
      await this.queueService_.enqueue(queueName, { ...result, routingAttempts: attempts });
    } catch (err) {
      this.logIf_('error', 'Failed to requeue another process’s task result', {
        taskId: result.taskId,
        error: err.message
      });
    }
  }

  /**
   * Resolves an activity reference to the script a worker will run
   * (feature 18). Registered names map to their configured path; relative
   * paths must stay inside the activities folder (symlinks included);
   * absolute paths must sit in the activities folder or a trusted root
   * unless `allowAbsolutePaths` is set. Nothing inside a filing store runs.
   *
   * @private
   * @param {string} scriptPath Activity name or path.
   * @return {Promise<string>}
   * @throws {ClientError} 400 when the script is not allowed.
   * @throws {Error} If the resolved path does not exist (filing wired in).
   */
  async resolveActivityPath_(scriptPath) {
    const resolvedPath = resolveActivityScript(scriptPath, {
      root: this.activitiesFolder_,
      registry: this.activityRegistry_,
      trustedRoots: this.trustedRoots_,
      allowAbsolutePaths: this.allowAbsolutePaths_
    });

    if (this.allowAbsolutePaths_ && path.isAbsolute(scriptPath) && !this.warnedAbsolute_) {
      this.warnedAbsolute_ = true;
      this.logIf_('warn', 'allowAbsolutePaths is deprecated: move activities into the activities folder or list them in `activities`', {
        scriptPath
      });
    }

    // Verify existence so we fail fast at queue time, not later inside a
    // worker. Only enforced when filing service is wired in (legacy).
    if (this.filingService_) {
      try {
        await fs.promises.access(resolvedPath);
      } catch (err) {
        throw new Error(`Activity script not found: ${scriptPath}`);
      }
    }

    return resolvedPath;
  }

  /**
   * The named activity registry, if one is configured.
   * @return {?Object<string, string>} name → path (a copy)
   */
  getActivityRegistry() {
    return this.activityRegistry_ ? { ...this.activityRegistry_ } : null;
  }

  /**
   * Queues a task for execution. Returns the new task ID immediately; the
   * actual worker thread is created when the queue processor next picks up
   * the task and a worker slot is free.
   *
   * @param {string} scriptPath Absolute or activities-relative script path.
   * @param {*=} data Payload passed to the worker script's `run` function.
   * @param {Function=} completionCallback Optional `(status, data) => void` callback.
   * @return {Promise<string>} The newly assigned task ID.
   * @throws {Error} If the manager is stopped, the queue is full, or the
   *   activity path cannot be resolved.
   */
  async start(scriptPath, data, completionCallback) {
    if (!this.isRunning_) {
      const error = 'Worker manager is stopped';
      this.eventEmitter_?.emit('worker:start:error', { scriptPath, error });
      throw new Error(error);
    }

    if (!this.queueService_) {
      const error = 'Queueing service is not available';
      this.eventEmitter_?.emit('worker:start:error', { scriptPath, error });
      throw new Error(error);
    }

    if (typeof scriptPath !== 'string' || scriptPath.length === 0) {
      const error = 'scriptPath must be a non-empty string';
      this.eventEmitter_?.emit('worker:start:error', { scriptPath, error });
      throw new Error(error);
    }

    // Enforce queue cap before resolving paths so a flood of bad calls cannot
    // pin the event loop on filesystem checks.
    const currentSize = await this.queueService_.size(this.QUEUE_INCOMING_);
    if (currentSize >= this.settings.maxQueueSize) {
      const error = `Incoming queue at capacity (${this.settings.maxQueueSize})`;
      this.eventEmitter_?.emit('worker:start:error', { scriptPath, error });
      this.logIf_('warn', 'Rejected task — queue full', {
        scriptPath,
        queueSize: currentSize,
        cap: this.settings.maxQueueSize
      });
      throw new Error(error);
    }

    let resolvedScriptPath;
    try {
      resolvedScriptPath = await this.resolveActivityPath_(scriptPath);
    } catch (err) {
      this.eventEmitter_?.emit('worker:start:error', { scriptPath, error: err.message });
      throw err;
    }

    const taskId = this.generateTaskId_();

    // The task must be SERIALISABLE — it may cross a process boundary. The
    // callback is held here and correlated back by task id (see the completion
    // waiters section); `origin` marks whose waiter is owed the result.
    const task = {
      id: taskId,
      scriptPath: resolvedScriptPath,
      originalScriptPath: scriptPath,
      data,
      origin: this.originId_,
      queuedAt: new Date()
    };

    this.registerWaiter_(taskId, completionCallback, resolvedScriptPath);

    try {
      await this.queueService_.enqueue(this.QUEUE_INCOMING_, task);
    } catch (err) {
      // Never leave a waiter behind for a task that was never queued — it would
      // sit until callbackTimeout and then report a misleading timeout instead
      // of the real enqueue failure.
      this.pendingCallbacks_.delete(taskId);
      throw err;
    }
    const queueSize = await this.queueService_.size(this.QUEUE_INCOMING_);

    this.eventEmitter_?.emit('worker:queued', {
      taskId,
      scriptPath: resolvedScriptPath,
      originalScriptPath: scriptPath,
      queueName: this.QUEUE_INCOMING_,
      queueLength: queueSize
    });

    this.logIf_('info', 'Task queued', {
      taskId,
      scriptPath: resolvedScriptPath,
      queueLength: queueSize
    });

    return taskId;
  }

  // ---------------------------------------------------------------------------
  // Queue processor
  // ---------------------------------------------------------------------------

  /**
   * Starts the polling queue processor. The interval is `unref()`'d so it
   * does not keep the Node event loop alive on its own — useful for tests.
   * @private
   */
  startQueueProcessor_() {
    if (this.queueProcessorInterval_) return;

    this.queueProcessorInterval_ = setInterval(() => {
      if (!this.isRunning_ || !this.queueService_) return;

      // Expiring waiters is local bookkeeping — run it even when the queue
      // backend is unreachable, since that is exactly when results go missing.
      this.sweepExpiredWaiters_();

      // ONE TICK AT A TIME. Each pass talks to the queueing backend, and with
      // an out-of-process one (ActiveMQ reads queue depth over HTTP) a pass can
      // outlast the 1s interval whenever the host is busy. Unguarded, the timer
      // keeps firing regardless and every stalled second adds another concurrent
      // round of requests — so a process briefly too busy to serve one poll ends
      // up owing ten, which is how a slow tick became a failing tick. The
      // backlog is not useful work: each pass re-reads the same queue state.
      if (this.tickInFlight_) {
        this.skippedTicks_++;
        return;
      }
      this.tickInFlight_ = true;

      Promise.allSettled([
        this.processQueue_().catch((err) => {
          this.logIf_('error', 'Queue processor tick failed', { error: err?.message });
        }),
        this.processResults_().catch((err) => {
          this.logIf_('error', 'Result processor tick failed', { error: err?.message });
        })
      ]).finally(() => {
        this.tickInFlight_ = false;
        if (this.skippedTicks_ > 0) {
          // Worth knowing: it means the backend or this process is running
          // slower than the poll interval. Reported once per catch-up rather
          // than per skip, so a busy period costs one line.
          this.logIf_('warn', 'Queue processor fell behind', { skippedTicks: this.skippedTicks_ });
          this.skippedTicks_ = 0;
        }
      });
    }, QUEUE_TICK_MS);

    // Don't keep the event loop alive just for the poller.
    if (typeof this.queueProcessorInterval_.unref === 'function') {
      this.queueProcessorInterval_.unref();
    }
  }

  /**
   * Stops the polling queue processor.
   * @private
   */
  stopQueueProcessor_() {
    if (this.queueProcessorInterval_) {
      clearInterval(this.queueProcessorInterval_);
      this.queueProcessorInterval_ = null;
    }
  }

  /**
   * Drains as many tasks from the incoming queue as there are free worker
   * slots, dispatching each into a fresh worker thread.
   * @return {Promise<void>}
   */
  async processQueue_() {
    if (!this.queueService_ || !this.isRunning_) return;

    while (this.activeWorkers_.size < this.maxThreads_) {
      const queueSize = await this.queueService_.size(this.QUEUE_INCOMING_);
      if (queueSize === 0) break;

      const task = await this.queueService_.dequeue(this.QUEUE_INCOMING_);
      if (!task) break;

      // Fire and forget — executeTask_ owns its own error handling.
      this.executeTask_(task);
    }
  }

  // ---------------------------------------------------------------------------
  // Worker execution
  // ---------------------------------------------------------------------------

  /**
   * Executes a single task in a fresh worker thread. Wires up message,
   * error, exit, and timeout handlers, and persists the result to either
   * the complete or error queue.
   *
   * @private
   * @param {!Object} task
   */
  async executeTask_(task) {
    let worker;
    try {
      worker = new Worker(path.resolve(__dirname, './workerScript.js'), {
        resourceLimits: this.workerResourceLimits_
      });
    } catch (err) {
      // Failure to even spawn a worker — record as error and bail.
      await this.recordError_(task, null, err.message, 'spawn');
      return;
    }

    const workerInfo = {
      worker,
      task,
      startedAt: new Date(),
      timeoutHandle: null,
      finalised: false
    };

    this.activeWorkers_.set(task.id, workerInfo);

    // Wall-clock timeout. Treats the task as errored and tears down the
    // worker even if the user code never returns. retryAttempts are not
    // honoured here because timeouts are typically unrecoverable.
    workerInfo.timeoutHandle = setTimeout(() => {
      if (workerInfo.finalised) return;
      this.handleTimeout_(workerInfo);
    }, this.settings.workerTimeout);
    if (typeof workerInfo.timeoutHandle.unref === 'function') {
      workerInfo.timeoutHandle.unref();
    }

    let incomingQueueSize = 0;
    try {
      incomingQueueSize = await this.queueService_.size(this.QUEUE_INCOMING_);
    } catch (_) { /* size is best-effort metadata */ }

    this.eventEmitter_?.emit('worker:start', {
      taskId: task.id,
      scriptPath: task.scriptPath,
      data: task.data,
      activeWorkers: this.activeWorkers_.size,
      incomingQueueSize
    });

    this.logIf_('info', 'Worker started', {
      taskId: task.id,
      scriptPath: task.scriptPath,
      activeWorkers: this.activeWorkers_.size
    });

    worker.on('message', async (message) => {
      if (!message || message.type !== 'status') return;

      this.eventEmitter_?.emit('worker:status', {
        taskId: task.id,
        status: message.status,
        data: message.data
      });

      if (message.status === 'completed' || message.status === 'error') {
        await this.finaliseTask_(workerInfo, message.status, message.data);
      }
    });

    worker.on('error', async (err) => {
      await this.recordError_(task, workerInfo, err.message, 'worker:error');
    });

    worker.on('exit', async (code) => {
      const taskInHistory = this.taskHistory_.get(task.id);
      if (code !== 0 && (!taskInHistory || taskInHistory.status !== 'completed')) {
        const errorMsg = `Worker exited with code ${code}`;
        if (!taskInHistory) {
          await this.recordError_(task, workerInfo, errorMsg, 'worker:exit');
        }
        this.eventEmitter_?.emit('worker:exit:error', { taskId: task.id, code });
      }
      this.eventEmitter_?.emit('worker:exit', { taskId: task.id, code });
      this.cleanupWorker_(task.id);
    });

    worker.postMessage({
      type: 'start',
      scriptPath: task.scriptPath,
      data: task.data
    });
  }

  /**
   * Marks a task as complete or errored, enqueues the result, fires the
   * user callback, and tears down the worker. Idempotent: subsequent calls
   * for the same workerInfo are no-ops so timeout + completion races don't
   * double-emit.
   *
   * @private
   * @param {!Object} workerInfo
   * @param {string} status `'completed'` or `'error'`.
   * @param {*} data Result payload (or error message for errors).
   */
  async finaliseTask_(workerInfo, status, data) {
    if (workerInfo.finalised) return;
    workerInfo.finalised = true;

    if (workerInfo.timeoutHandle) {
      clearTimeout(workerInfo.timeoutHandle);
      workerInfo.timeoutHandle = null;
    }

    const { task } = workerInfo;
    const taskResult = {
      taskId: task.id,
      scriptPath: task.scriptPath,
      status,
      result: status === 'completed' ? data : undefined,
      error: status === 'error' ? data : undefined,
      // Carries the waiter's owner through to the result so processResults_ in
      // whichever process holds that waiter can recognise it.
      origin: task.origin,
      queuedAt: task.queuedAt,
      startedAt: workerInfo.startedAt,
      completedAt: new Date()
    };

    this.recordHistory_(taskResult);

    // Settle in-process FIRST when we own the waiter. This is the single-process
    // case and it must not pay a broker round trip: the caller is resumed at
    // exactly the point it was before, and the queued copy below is then drained
    // by our own processResults_ as a no-op.
    const settledLocally = this.settleWaiter_(task.id, status, data);

    if (this.queueService_) {
      try {
        const queue = status === 'completed' ? this.QUEUE_COMPLETE_ : this.QUEUE_ERROR_;
        await this.queueService_.enqueue(queue, taskResult);
      } catch (err) {
        this.eventEmitter_?.emit('worker:queue:error', {
          taskId: task.id,
          error: err.message
        });
        this.logIf_('error', 'Failed to enqueue task result', {
          taskId: task.id,
          error: err.message
        });

        // The result never reached the queue, so a REMOTE waiter will never see
        // it and would hang until its deadline. Nothing can be done for it here
        // — surface it plainly rather than letting it fail silently later.
        if (!settledLocally && task.origin && task.origin !== this.originId_) {
          this.logIf_('error', 'Task result lost — the waiting process cannot be notified', {
            taskId: task.id,
            origin: task.origin
          });
        }
      }
    }

    this.cleanupWorker_(task.id);
  }

  /**
   * Convenience for the various error code paths (worker error event,
   * non-zero exit, spawn failure). Routes through {@link finaliseTask_} so
   * the bookkeeping stays in one place.
   *
   * @private
   * @param {!Object} task
   * @param {?Object} workerInfo Active worker info, or null if spawning failed.
   * @param {string} message Error message.
   * @param {string} source Tag identifying which handler triggered the error.
   */
  async recordError_(task, workerInfo, message, source) {
    this.eventEmitter_?.emit('worker:error', {
      taskId: task.id,
      error: message,
      source
    });
    this.logIf_('error', 'Worker errored', {
      taskId: task.id,
      error: message,
      source
    });

    if (workerInfo) {
      await this.finaliseTask_(workerInfo, 'error', message);
      return;
    }

    // No active worker (spawn failed) — write history + queue directly.
    const taskResult = {
      taskId: task.id,
      scriptPath: task.scriptPath,
      status: 'error',
      error: message,
      origin: task.origin,
      queuedAt: task.queuedAt,
      startedAt: new Date(),
      completedAt: new Date()
    };
    this.recordHistory_(taskResult);

    this.settleWaiter_(task.id, 'error', message);

    if (this.queueService_) {
      try {
        await this.queueService_.enqueue(this.QUEUE_ERROR_, taskResult);
      } catch (_) { /* best effort */ }
    }
  }

  /**
   * Handles a worker timeout: terminates the worker and records the task
   * as errored with a timeout-specific message.
   *
   * @private
   * @param {!Object} workerInfo
   */
  handleTimeout_(workerInfo) {
    const { task, worker } = workerInfo;
    const message = `Worker timed out after ${this.settings.workerTimeout}ms`;

    this.eventEmitter_?.emit('worker:timeout', {
      taskId: task.id,
      timeoutMs: this.settings.workerTimeout
    });
    this.logIf_('warn', 'Worker timed out', {
      taskId: task.id,
      timeoutMs: this.settings.workerTimeout
    });

    // Terminate but don't await — finaliseTask_ runs synchronously below
    // and the exit handler will be a no-op once finalised is true.
    try {
      worker.terminate();
    } catch (_) { /* worker may already be gone */ }

    // Record before cleanupWorker_ removes the entry.
    this.finaliseTask_(workerInfo, 'error', message).catch(() => {});
  }

  /**
   * Persists a task result to the in-memory history map, evicting the
   * oldest entry if the history limit is exceeded.
   *
   * @private
   * @param {!Object} taskResult
   */
  recordHistory_(taskResult) {
    this.taskHistory_.set(taskResult.taskId, taskResult);
    if (this.taskHistory_.size > TASK_HISTORY_LIMIT) {
      const oldestKey = this.taskHistory_.keys().next().value;
      this.taskHistory_.delete(oldestKey);
    }
  }

  /**
   * Removes the worker entry and best-effort terminates the underlying
   * thread. Safe to call repeatedly.
   *
   * @private
   * @param {string} taskId
   */
  cleanupWorker_(taskId) {
    const workerInfo = this.activeWorkers_.get(taskId);
    if (!workerInfo) return;

    if (workerInfo.timeoutHandle) {
      clearTimeout(workerInfo.timeoutHandle);
      workerInfo.timeoutHandle = null;
    }

    try {
      workerInfo.worker.terminate();
    } catch (_) { /* worker may already be terminated */ }

    this.activeWorkers_.delete(taskId);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Stops the worker manager: marks it as not running, halts the queue
   * processor, and terminates all active workers in parallel. Tasks still
   * sitting in the incoming queue are left in place — when the service is
   * restarted with the same queueing backend they will be picked up again.
   *
   * @return {Promise<void>}
   */
  async stop() {
    this.isRunning_ = false;
    this.stopQueueProcessor_();

    let incomingQueueSize = 0;
    if (this.queueService_) {
      try {
        incomingQueueSize = await this.queueService_.size(this.QUEUE_INCOMING_);
      } catch (_) { /* best effort */ }
    }

    this.eventEmitter_?.emit('worker:manager:stopping', {
      incomingQueueSize,
      activeWorkers: this.activeWorkers_.size
    });
    this.logIf_('info', 'Worker manager stopping', {
      incomingQueueSize,
      activeWorkers: this.activeWorkers_.size
    });

    const terminationPromises = [];
    for (const [, workerInfo] of this.activeWorkers_.entries()) {
      if (workerInfo.timeoutHandle) {
        clearTimeout(workerInfo.timeoutHandle);
        workerInfo.timeoutHandle = null;
      }
      terminationPromises.push(
        new Promise((resolve) => {
          try {
            const result = workerInfo.worker.terminate();
            if (result && typeof result.then === 'function') {
              result.then(() => resolve()).catch(() => resolve());
            } else {
              resolve();
            }
          } catch (_) {
            resolve();
          }
        })
      );
    }

    await Promise.all(terminationPromises);
    this.activeWorkers_.clear();

    // Fail anything still waiting. The workers that would have produced these
    // results have just been terminated, so a caller left holding an unsettled
    // promise would wait for a result that is now guaranteed never to arrive —
    // the same silent hang this design exists to prevent, at shutdown.
    if (this.pendingCallbacks_.size > 0) {
      const stranded = this.pendingCallbacks_.size;
      for (const [taskId, waiter] of this.pendingCallbacks_) {
        this.pendingCallbacks_.delete(taskId);
        try {
          waiter.callback('error', 'Worker manager stopped before the task completed');
        } catch (_) { /* swallow — the caller's own handler failed */ }
      }
      this.logIf_('warn', 'Failed pending callbacks on shutdown', { stranded });
    }

    this.eventEmitter_?.emit('worker:manager:stopped');
    this.logIf_('info', 'Worker manager stopped');
  }

  // ---------------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------------

  /**
   * Returns a snapshot of manager state suitable for dashboards and tests.
   * Queue sizes are read from the queueing service so they reflect what
   * external observers would also see.
   *
   * @return {Promise<!Object>}
   */
  async getStatus() {
    let incomingQueueSize = 0;
    let completeQueueSize = 0;
    let errorQueueSize = 0;

    if (this.queueService_) {
      try {
        incomingQueueSize = await this.queueService_.size(this.QUEUE_INCOMING_);
        completeQueueSize = await this.queueService_.size(this.QUEUE_COMPLETE_);
        errorQueueSize    = await this.queueService_.size(this.QUEUE_ERROR_);
      } catch (_) { /* best effort */ }
    }

    return {
      isRunning: this.isRunning_,
      originId: this.originId_,
      maxThreads: this.maxThreads_,
      activeWorkers: this.activeWorkers_.size,
      // Results are now consumed rather than accumulated, so `complete`/`error`
      // read near zero on a healthy system; task outcomes live in the history
      // below (getTaskHistory), not in queue depth.
      queues: {
        incoming: incomingQueueSize,
        complete: completeQueueSize,
        error: errorQueueSize
      },
      pendingCallbacks: this.pendingCallbacks_.size,
      completedTasks: this.taskHistory_.size
    };
  }

  /**
   * Returns recent task history, newest first.
   *
   * @param {number=} limit Maximum number of entries to return (default 100).
   * @return {Promise<!Array<!Object>>}
   */
  async getTaskHistory(limit = 100) {
    return Array.from(this.taskHistory_.values())
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);
  }

  /**
   * Returns a single task by ID, or null if not found.
   *
   * @param {string} taskId
   * @return {Promise<?Object>}
   */
  async getTask(taskId) {
    return this.taskHistory_.get(taskId) || null;
  }
}

module.exports = WorkerManager;
