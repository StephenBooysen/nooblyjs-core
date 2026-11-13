/**
 * @fileoverview Workflow Service
 * Service for defining and executing multi-step workflows with worker thread support.
 * Provides sequential step execution with error handling and event emission.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const WorkflowApi = require('./providers/workflowApi');
const WorkflowAnalytics = require('./modules/analytics');
const WorkflowDefinitionContainer = require('./containers/WorkflowDefinitionContainer');
const WorkflowExecutionContainer = require('./containers/WorkflowExecutionContainer');
const WorkflowScheduleContainer = require('./containers/WorkflowScheduleContainer');
const { WorkflowScheduler } = require('./modules/workflowScheduler');
const { summarizeExecution, summarizeExecutions, classifyExecution } = require('./modules/executionSummary');
const Routes = require('./routes');
const Views = require('./views');
const Scripts = require('./scripts');

/** @type {WorkflowAnalytics} */
let analyticsInstance = null;

/** @const {number} Version stamped on exported state snapshots. */
const STATE_VERSION = 1;

/** @const {number} Longest workflow name accepted by the manager API. */
const MAX_NAME_LENGTH = 200;

/** @const {number} Most steps a managed workflow may have. */
const MAX_STEPS = 100;

/**
 * Creates an Error carrying an HTTP status, so routes can map service
 * failures (not found, conflict, validation) to the right response code.
 *
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @return {!Error} The error
 * @private
 */
function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Returns true if a value is a plain (non-array) object.
 * @param {*} value - Candidate value
 * @return {boolean} True for plain objects
 * @private
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * WorkflowService class for managing and executing workflows.
 * Uses the working service to execute individual steps via worker threads.
 */
class WorkflowService {
  /**
   * Creates a new WorkflowService instance.
   *
   * All workflow state - definitions, execution history and schedules - is
   * held in memory. The consuming application decides where (and whether) it
   * is stored: seed it with `options.state` / {@link importState}, and save it
   * from {@link exportState} whenever `workflow:state:changed` is emitted.
   *
   * @param {EventEmitter} eventEmitter - Global event emitter for workflow events
   * @param {Object} workingService - Working service instance for executing tasks
   * @param {Object} [options] - Service options
   * @param {number} [options.maxExecutionsPerWorkflow=1000] - History retained per workflow
   * @param {boolean} [options.scheduleCatchUp=true] - Replay schedule fires that were missed
   * @param {number} [options.catchUpGraceMs=120000] - Lateness after which a fire counts as missed
   * @param {number} [options.catchUpStaggerMs=20000] - Gap between catch-up runs
   * @param {boolean} [options.autoStartScheduler=true] - Arm the schedule timer automatically
   * @param {Object} [options.state] - Snapshot from {@link exportState} to start from
   */
  constructor(eventEmitter, workingService, options = {}) {
    /** @private {Map<string, Array<string>>} Map of workflow names to step file paths (deprecated - use definitionContainer) */
    this.workflows = new Map();

    /** @private {WorkflowDefinitionContainer} Container for workflow definitions */
    this.definitionContainer = new WorkflowDefinitionContainer();

    /** @private {WorkflowExecutionContainer} Container for workflow executions */
    this.executionContainer = new WorkflowExecutionContainer({
      maxExecutionsPerWorkflow: options.maxExecutionsPerWorkflow || 1000
    });

    /** @private {WorkflowScheduleContainer} Container for workflow schedules */
    this.scheduleContainer = new WorkflowScheduleContainer();

    /** @private {Map<string, {starred: boolean, lastViewed: ?string}>} Per-workflow UI state */
    this.workflowState_ = new Map();

    /** @private {Set<string>} Executions asked to stop before their next step */
    this.cancelRequests_ = new Set();

    /** @private {EventEmitter} Global event emitter */
    this.eventEmitter_ = eventEmitter;

    /** @private {Object} Working service for task execution */
    this.workingService_ = workingService;

    // Settings configuration
    this.settings = {};
    this.settings.description = "Configuration settings for the workflow service";
    this.settings.list = [
      { setting: 'maxSteps', type: 'number', values: null },
      { setting: 'timeoutPerStep', type: 'number', values: null },
      { setting: 'parallelExecution', type: 'boolean', values: null }
    ];
    this.settings.maxSteps = 50;
    this.settings.timeoutPerStep = 60000;
    this.settings.parallelExecution = false;
    this.settings.list.push({ setting: 'scheduleCatchUp', type: 'boolean', values: null });
    this.settings.scheduleCatchUp = options.scheduleCatchUp !== false;

    /** @private {WorkflowScheduler} Fires schedules and keeps their bookkeeping */
    this.scheduler = new WorkflowScheduler({
      store: this.scheduleContainer,
      eventEmitter,
      catchUp: this.settings.scheduleCatchUp,
      catchUpGraceMs: options.catchUpGraceMs,
      catchUpStaggerMs: options.catchUpStaggerMs,
      autoStart: options.autoStartScheduler !== false,
      run: (schedule, { trigger }) => this.executeWorkflow(schedule.workflowName, schedule.input, {
        trigger,
        scheduleId: schedule.id,
        scheduleName: schedule.name
      }),
      onChange: (scheduleId) => this.notifyChange_('schedules', { scheduleId })
    });

    if (options.state) {
      this.importState(options.state);
    }
  }

  /**
   * Emits `workflow:state:changed` so a consuming application can persist the
   * part of the in-memory state that changed.
   *
   * @param {string} kind - 'workflows', 'executions' or 'schedules'
   * @param {Object} [detail] - Identifiers of what changed
   * @private
   */
  notifyChange_(kind, detail = {}) {
    this.eventEmitter_?.emit('workflow:state:changed', { kind, ...detail, at: new Date().toISOString() });
  }

  /**
   * Defines a new workflow with specified steps.
   * @param {string} workflowName - Unique name for the workflow
   * @param {Array<string>} steps - Array of file paths to step implementations
   * @param {Object} metadata - Optional metadata for the workflow
   * @throws {Error} When workflowName is invalid or steps array is empty
   */
  /**
   * Checks each step is an acceptable activity path (relative, inside the
   * activities folder, a script extension). Steps run through the working
   * service, which enforces the same rules again at execution time (feature 18).
   *
   * @private
   * @param {Array<string>} steps Step script paths
   * @throws {Error} When a step is refused
   */
  assertSafeSteps_(steps) {
    for (const step of steps) {
      try {
        this.workingService_?.validateActivityPath?.(step);
      } catch (err) {
        throw new Error(`Invalid workflow step "${step}": ${err.message}`);
      }
    }
  }

  async defineWorkflow(workflowName, steps, metadata = {}) {
    if (!workflowName || typeof workflowName !== 'string') {
      throw new Error('Workflow name must be a non-empty string');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Steps must be a non-empty array of file paths');
    }
    this.assertSafeSteps_(steps);

    // Store in both legacy map and new container for backwards compatibility
    this.workflows.set(workflowName, steps);
    const definition = this.definitionContainer.define(workflowName, steps, metadata);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('workflow:defined', { workflowName, steps, definition });
    }

    return definition;
  }

  /**
   * Executes a defined workflow with the provided data.
   * Each step receives the original input data plus all previous step outputs
   * in an accumulated format with a 'steps' array containing step metadata.
   *
   * Data structure passed to each step:
   * {
   *   ...originalInputData,  // All original keys preserved
   *   steps: [               // Array of previous step results
   *     {
   *       stepNumber: 1,
   *       stepName: "step_file_name",
   *       stepPath: "/full/path/to/step.js",
   *       data: { ...stepOutput }
   *     }
   *   ]
   * }
   *
   * @param {string} workflowName - Name of the workflow to execute
   * @param {Object} data - Initial data object to pass to first step
   * @param {function} statusCallback - Callback function for workflow progress updates
   *   Receives objects with status: 'step_start', 'step_end', 'step_error', 'workflow_complete'
   *   Each callback includes stepNumber and accumulated data
   * @param {Object} [options] - Run options
   * @param {string} [options.executionId] - Id to record the run under (generated when omitted)
   * @param {string} [options.trigger='api'] - What started the run (api, manual, schedule, catch-up, run-now)
   * @param {string} [options.scheduleId] - Schedule that started the run
   * @param {string} [options.scheduleName] - Name of that schedule
   * @return {Promise<Object>} The completed execution record
   * @throws {Error} When workflow is not found, step execution fails, or the run is cancelled
   *
   * @example
   * await workflow.runWorkflow('order_processing',
   *   { orderId: 123, amount: 50 },
   *   (status) => {
   *     if (status.status === 'workflow_complete') {
   *       console.log('Final data:', status.finalData);
   *       console.log('Steps executed:', status.finalData.steps.length);
   *     }
   *   }
   * );
   */
  async runWorkflow(workflowName, data, statusCallback = () => {}, options = {}) {
    const steps = this.workflows.get(workflowName);
    if (!steps) {
      const error = new Error(`Workflow '${workflowName}' not found.`);
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('workflow:error', {
          workflowName,
          error: error.message,
        });
      }
      throw error;
    }

    if (!this.workingService_) {
      const error = new Error('Working service not available');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('workflow:error', {
          workflowName,
          error: error.message,
        });
      }
      throw error;
    }

    // Ensure statusCallback is a function
    if (typeof statusCallback !== 'function') {
      statusCallback = () => {};
    }
    const runOptions = isPlainObject(options) ? options : {};

    // Preserve original input data and initialize steps accumulator
    const originalData = data || {};
    const accumulatedSteps = [];

    // Unique execution ID - also reported as `workflowId` on events for analytics
    const workflowId = runOptions.executionId
      || `${workflowName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const executionStartTime = Date.now();
    const stepExecutions = [];
    const definition = this.definitionContainer.get(workflowName);

    // Fields every version of this run's record carries.
    const recordBase = {
      executionId: workflowId,
      inputData: originalData,
      startedAt: new Date(executionStartTime).toISOString(),
      trigger: runOptions.trigger || 'api',
      scheduleId: runOptions.scheduleId || null,
      scheduleName: runOptions.scheduleName || null,
      group: definition?.metadata?.group || null,
      stepCount: steps.length
    };

    // A "running" record makes in-flight runs visible; the final record
    // below replaces it in place.
    this.executionContainer.record(workflowName, {
      ...recordBase,
      status: 'running',
      currentStep: 0,
      stepExecutions
    });
    this.notifyChange_('executions', { workflowName, executionId: workflowId });

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('workflow:start', {
        workflowName,
        workflowId,
        initialData: data,
      });
    }

    let cancelled = false;

    try {
      for (let i = 0; i < steps.length; i++) {
        const stepPath = steps[i];
        const stepNumber = i + 1;
        const stepFileName = path.basename(stepPath, '.js');
        const stepName = `Step ${stepNumber}: ${path.basename(stepPath)}`;
        const stepStartTime = Date.now();

        // Cancellation is cooperative: a step already dispatched to a worker
        // runs to completion, and the run stops before the next one.
        if (this.cancelRequests_.has(workflowId)) {
          cancelled = true;
          throw new Error(`Execution cancelled before step ${stepNumber}`);
        }

        this.executionContainer.update(workflowId, { currentStep: stepNumber });

        // Build current accumulated data structure
        const currentAccumulatedData = {
          ...originalData,
          steps: [...accumulatedSteps]
        };

        statusCallback({
          status: 'step_start',
          stepName,
          stepPath,
          stepNumber,
          data: currentAccumulatedData,
        });
        if (this.eventEmitter_)
          this.eventEmitter_.emit('workflow:step:start', {
            workflowName,
            stepName,
            stepPath,
            stepNumber,
            data: currentAccumulatedData,
          });

        try {
          // Use the working service to execute the step
          const stepOutput = await new Promise(async (resolve, reject) => {
            try {
              await this.workingService_.start(stepPath, currentAccumulatedData, (status, result) => {
                if (status === 'completed') {
                  resolve(result);
                } else if (status === 'error') {
                  reject(new Error(result));
                }
              });
            } catch (err) {
              reject(err);
            }
          });

          // Ensure step output is an object (handle primitives)
          const safeStepOutput = (typeof stepOutput === 'object' && stepOutput !== null)
            ? stepOutput
            : { value: stepOutput };

          // Add to accumulated steps
          accumulatedSteps.push({
            stepNumber,
            stepName: stepFileName,
            stepPath,
            data: safeStepOutput
          });

          const stepDuration = Date.now() - stepStartTime;
          stepExecutions.push({
            stepName,
            stepPath,
            inputData: currentAccumulatedData,
            outputData: safeStepOutput,
            status: 'completed',
            startedAt: new Date(stepStartTime).toISOString(),
            endedAt: new Date().toISOString(),
            duration: stepDuration,
            error: null
          });

          const newAccumulatedData = {
            ...originalData,
            steps: [...accumulatedSteps]
          };

          statusCallback({
            status: 'step_end',
            stepName,
            stepPath,
            stepNumber,
            data: newAccumulatedData,
            stepOutput: safeStepOutput,
          });
          if (this.eventEmitter_)
            this.eventEmitter_.emit('workflow:step:end', {
              workflowName,
              stepName,
              stepPath,
              stepNumber,
              data: newAccumulatedData,
              stepOutput: safeStepOutput,
            });
        } catch (error) {
          const stepDuration = Date.now() - stepStartTime;

          const partialAccumulatedData = {
            ...originalData,
            steps: [...accumulatedSteps]
          };

          stepExecutions.push({
            stepName,
            stepPath,
            inputData: currentAccumulatedData,
            outputData: null,
            status: 'error',
            startedAt: new Date(stepStartTime).toISOString(),
            endedAt: new Date().toISOString(),
            duration: stepDuration,
            error: error.message
          });

          statusCallback({
            status: 'step_error',
            stepName,
            stepPath,
            stepNumber,
            error: error.message,
            partialData: partialAccumulatedData,
          });
          if (this.eventEmitter_) {
            this.eventEmitter_.emit('workflow:step:error', {
              workflowName,
              stepName,
              stepPath,
              stepNumber,
              error: error.message,
              partialData: partialAccumulatedData,
            });
            // Emit workflow:error for analytics tracking
            this.eventEmitter_.emit('workflow:error', {
              workflowName,
              workflowId,
              error: error.message,
              partialData: partialAccumulatedData,
            });
          }
          throw error; // Re-throw to stop workflow execution on error
        }
      }

      // Build final accumulated data
      const finalAccumulatedData = {
        ...originalData,
        steps: [...accumulatedSteps]
      };

      // Record successful execution
      const totalDuration = Date.now() - executionStartTime;
      const execution = this.executionContainer.record(workflowName, {
        ...recordBase,
        outputData: finalAccumulatedData,
        status: 'completed',
        endedAt: new Date().toISOString(),
        duration: totalDuration,
        error: null,
        currentStep: steps.length,
        stepExecutions
      });
      this.notifyChange_('executions', { workflowName, executionId: workflowId });

      statusCallback({
        status: 'workflow_complete',
        workflowName,
        finalData: finalAccumulatedData,
        steps: accumulatedSteps,
      });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:complete', {
          workflowName,
          workflowId,
          finalData: finalAccumulatedData,
          steps: accumulatedSteps,
        });

      return execution;
    } catch (error) {
      // Build partial accumulated data (may have some successful steps before the error)
      const partialAccumulatedData = {
        ...originalData,
        steps: [...accumulatedSteps]
      };

      // Record failed (or cancelled) execution
      const totalDuration = Date.now() - executionStartTime;
      this.executionContainer.record(workflowName, {
        ...recordBase,
        outputData: partialAccumulatedData,
        status: cancelled ? 'cancelled' : 'error',
        endedAt: new Date().toISOString(),
        duration: totalDuration,
        error: error.message,
        stepExecutions
      });
      this.notifyChange_('executions', { workflowName, executionId: workflowId });

      if (cancelled && this.eventEmitter_) {
        this.eventEmitter_.emit('workflow:cancelled', { workflowName, workflowId });
      }

      throw error;
    } finally {
      this.cancelRequests_.delete(workflowId);
    }
  }

  /**
   * Get all settings for the workflow service.
   * @return {Promise<Object>} A promise that resolves to the settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Save settings for the workflow service.
   * @param {Object} settings The settings to save.
   * @return {Promise<void>} A promise that resolves when settings are saved.
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
    this.settings.scheduleCatchUp = this.settings.scheduleCatchUp !== false
      && this.settings.scheduleCatchUp !== 'false';
    this.scheduler.catchUp = this.settings.scheduleCatchUp;
  }
  // ===========================================================================
  // Workflow management
  // ===========================================================================

  /**
   * Throws a 404 error unless a workflow is defined.
   * @param {string} workflowName - Workflow name
   * @return {Object} The workflow definition
   * @throws {Error} When the workflow does not exist (statusCode 404)
   * @private
   */
  requireWorkflow_(workflowName) {
    const definition = this.definitionContainer.get(workflowName);
    if (!definition) {
      throw httpError(`Workflow '${workflowName}' not found`, 404);
    }
    return definition;
  }

  /**
   * Builds the list/detail view of a workflow: its definition plus UI state
   * and whether it is scheduled.
   * @param {Object} definition - Workflow definition
   * @return {Object} Workflow view
   * @private
   */
  workflowView_(definition) {
    const meta = definition.metadata || {};
    const state = this.workflowState_.get(definition.name) || {};
    const schedules = this.scheduleContainer.list({ workflowName: definition.name });
    let status = null;
    if (schedules.length > 0) {
      status = schedules.some(s => s.enabled) ? 'active' : 'inactive';
    }
    return {
      id: definition.name,
      name: definition.name,
      description: meta.description || '',
      group: meta.group || null,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      steps: definition.steps.slice(),
      stepCount: definition.steps.length,
      defaultInput: isPlainObject(meta.defaultInput) ? meta.defaultInput : null,
      starred: !!state.starred,
      lastViewed: state.lastViewed || null,
      createdAt: meta.createdAt || null,
      updatedAt: meta.updatedAt || null,
      modifiedAt: meta.updatedAt || null,
      version: meta.version || 1,
      status,
      scheduleCount: schedules.length
    };
  }

  /**
   * Validates workflow input for create/update/import.
   * @param {Object} data - Workflow data
   * @param {boolean} partial - True for updates, where fields are optional
   * @throws {Error} When the data is invalid (statusCode 400)
   * @private
   */
  validateWorkflowData_(data, partial) {
    const errors = [];
    if (!isPlainObject(data)) {
      throw httpError('Workflow data must be an object', 400);
    }
    if (!partial || data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim() === '') {
        errors.push('name is required and must be a non-empty string');
      } else if (data.name.length > MAX_NAME_LENGTH) {
        errors.push(`name must be ${MAX_NAME_LENGTH} characters or less`);
      }
    }
    if (!partial || data.steps !== undefined) {
      if (!Array.isArray(data.steps) || data.steps.length === 0) {
        errors.push('steps must be a non-empty array of step file paths');
      } else {
        const limit = Math.min(MAX_STEPS, Number(this.settings.maxSteps) || MAX_STEPS);
        if (data.steps.length > limit) errors.push(`a workflow cannot have more than ${limit} steps`);
        data.steps.forEach((step, i) => {
          if (typeof step !== 'string' || step.trim() === '') {
            errors.push(`step ${i + 1} must be a non-empty file path`);
          }
        });
      }
    }
    if (data.description !== undefined && typeof data.description !== 'string') {
      errors.push('description must be a string');
    }
    if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some(t => typeof t !== 'string'))) {
      errors.push('tags must be an array of strings');
    }
    if (data.group !== undefined && data.group !== null && typeof data.group !== 'string') {
      errors.push('group must be a string');
    }
    if (data.defaultInput !== undefined && data.defaultInput !== null && !isPlainObject(data.defaultInput)) {
      errors.push('defaultInput must be an object');
    }
    if (errors.length > 0) {
      throw httpError(`Workflow validation failed: ${errors.join('; ')}`, 400);
    }
  }

  /**
   * Lists workflows with their schedule status, sorted by group then name.
   *
   * @param {Object} [options] - Filters
   * @param {boolean} [options.starred] - Only starred workflows
   * @param {Array<string>} [options.tags] - Only workflows carrying any of these tags
   * @param {string} [options.group] - Only this group
   * @param {string} [options.search] - Case-insensitive match on name, description, group or tags
   * @return {Array<Object>} Workflow views
   *
   * @example
   * const starred = workflow.listWorkflows({ starred: true });
   */
  listWorkflows(options = {}) {
    const search = options.search ? String(options.search).toLowerCase() : '';
    const tags = Array.isArray(options.tags) ? options.tags : null;

    return this.definitionContainer.getAll()
      .map(def => this.workflowView_(def))
      .filter((w) => {
        if (options.starred && !w.starred) return false;
        if (options.group && (w.group || '') !== options.group) return false;
        if (tags && tags.length && !tags.some(t => w.tags.includes(t))) return false;
        if (!search) return true;
        return w.name.toLowerCase().includes(search)
          || w.description.toLowerCase().includes(search)
          || String(w.group || '').toLowerCase().includes(search)
          || w.tags.some(t => t.toLowerCase().includes(search));
      })
      .sort((a, b) => String(a.group || '').localeCompare(String(b.group || ''))
        || a.name.localeCompare(b.name));
  }

  /**
   * Lists the distinct workflow groups.
   * @return {Array<string>} Sorted group names ('' for ungrouped workflows is omitted)
   */
  listGroups() {
    const groups = new Set();
    for (const def of this.definitionContainer.getAll()) {
      if (def.metadata && def.metadata.group) groups.add(def.metadata.group);
    }
    return Array.from(groups).sort();
  }

  /**
   * Gets one workflow's view.
   * @param {string} workflowName - Workflow name
   * @return {Object} Workflow view
   * @throws {Error} When the workflow does not exist (statusCode 404)
   */
  getWorkflow(workflowName) {
    return this.workflowView_(this.requireWorkflow_(workflowName));
  }

  /**
   * Creates a workflow. Unlike {@link defineWorkflow}, refuses to overwrite an
   * existing workflow.
   *
   * @param {Object} data - Workflow data
   * @param {string} data.name - Unique workflow name
   * @param {Array<string>} data.steps - Step file paths, run in order
   * @param {string} [data.description] - Description
   * @param {Array<string>} [data.tags] - Tags
   * @param {string} [data.group] - Group the workflow is listed under
   * @param {Object} [data.defaultInput] - Input used when a run supplies none
   * @return {Promise<Object>} The created workflow view
   * @throws {Error} On invalid data (400) or a duplicate name (409)
   *
   * @example
   * await workflow.createWorkflow({
   *   name: 'nightly-ingest',
   *   group: 'ingestion',
   *   steps: ['/app/steps/fetch.js', '/app/steps/index.js']
   * });
   */
  async createWorkflow(data) {
    this.validateWorkflowData_(data, false);
    const name = data.name.trim();
    if (this.definitionContainer.exists(name)) {
      throw httpError(`Workflow '${name}' already exists`, 409);
    }
    await this.defineWorkflow(name, data.steps.map(s => s.trim()), {
      description: data.description || '',
      tags: data.tags || [],
      group: data.group ? data.group.trim() : null,
      defaultInput: data.defaultInput || null
    });
    this.notifyChange_('workflows', { workflowName: name });
    return this.getWorkflow(name);
  }

  /**
   * Updates a workflow's steps and/or metadata, optionally renaming it. A
   * rename carries the workflow's history, schedules and UI state across.
   *
   * @param {string} workflowName - Current workflow name
   * @param {Object} changes - Fields to change (name, steps, description, tags, group, defaultInput)
   * @return {Promise<Object>} The updated workflow view
   * @throws {Error} When missing (404), invalid (400) or the new name is taken (409)
   */
  async updateWorkflow(workflowName, changes) {
    this.requireWorkflow_(workflowName);
    this.validateWorkflowData_(changes, true);

    let name = workflowName;
    if (changes.name !== undefined && changes.name.trim() !== workflowName) {
      const newName = changes.name.trim();
      if (this.definitionContainer.exists(newName)) {
        throw httpError(`Workflow '${newName}' already exists`, 409);
      }
      this.definitionContainer.rename(workflowName, newName);
      this.workflows.set(newName, this.workflows.get(workflowName));
      this.workflows.delete(workflowName);
      this.executionContainer.rename(workflowName, newName);
      if (this.workflowState_.has(workflowName)) {
        this.workflowState_.set(newName, this.workflowState_.get(workflowName));
        this.workflowState_.delete(workflowName);
      }
      for (const schedule of this.scheduleContainer.list({ workflowName })) {
        this.scheduleContainer.update(schedule.id, { workflowName: newName });
      }
      this.notifyChange_('schedules', { workflowName: newName });
      this.notifyChange_('executions', { workflowName: newName });
      name = newName;
    }

    if (changes.steps !== undefined) {
      const steps = changes.steps.map(s => s.trim());
      this.assertSafeSteps_(steps);
      this.definitionContainer.updateSteps(name, steps);
      this.workflows.set(name, steps);
    }

    const metadata = {};
    if (changes.description !== undefined) metadata.description = changes.description;
    if (changes.tags !== undefined) metadata.tags = changes.tags;
    if (changes.group !== undefined) metadata.group = changes.group ? changes.group.trim() : null;
    if (changes.defaultInput !== undefined) metadata.defaultInput = changes.defaultInput || null;
    if (Object.keys(metadata).length > 0) {
      this.definitionContainer.updateMetadata(name, metadata);
    }

    this.notifyChange_('workflows', { workflowName: name, previousName: name !== workflowName ? workflowName : undefined });
    this.eventEmitter_?.emit('workflow:updated', { workflowName: name, previousName: workflowName });
    return this.getWorkflow(name);
  }

  /**
   * Deletes a workflow together with its schedules and execution history.
   * @param {string} workflowName - Workflow name
   * @return {Promise<{deleted: boolean, schedulesRemoved: number, executionsRemoved: number}>}
   * @throws {Error} When the workflow does not exist (statusCode 404)
   */
  async deleteWorkflow(workflowName) {
    this.requireWorkflow_(workflowName);
    const schedules = this.scheduleContainer.list({ workflowName });
    for (const schedule of schedules) this.scheduleContainer.delete(schedule.id);
    const executionsRemoved = this.executionContainer.count(workflowName);
    this.executionContainer.clear(workflowName);
    this.definitionContainer.delete(workflowName);
    this.workflows.delete(workflowName);
    this.workflowState_.delete(workflowName);

    this.scheduler.arm();
    this.notifyChange_('workflows', { workflowName, deleted: true });
    if (schedules.length) this.notifyChange_('schedules', { workflowName });
    if (executionsRemoved) this.notifyChange_('executions', { workflowName });
    this.eventEmitter_?.emit('workflow:deleted', { workflowName });
    return { deleted: true, schedulesRemoved: schedules.length, executionsRemoved };
  }

  /**
   * Stars or un-stars a workflow.
   * @param {string} workflowName - Workflow name
   * @param {boolean} starred - New star state
   * @return {Object} The workflow view
   */
  setStarred(workflowName, starred) {
    this.requireWorkflow_(workflowName);
    const state = this.workflowState_.get(workflowName) || {};
    this.workflowState_.set(workflowName, { ...state, starred: !!starred });
    this.notifyChange_('workflows', { workflowName });
    return this.getWorkflow(workflowName);
  }

  /**
   * Records that a workflow was opened, for "recently viewed" lists.
   * @param {string} workflowName - Workflow name
   * @return {Object} The workflow view
   */
  markViewed(workflowName) {
    this.requireWorkflow_(workflowName);
    const state = this.workflowState_.get(workflowName) || {};
    this.workflowState_.set(workflowName, { ...state, lastViewed: new Date().toISOString() });
    this.notifyChange_('workflows', { workflowName });
    return this.getWorkflow(workflowName);
  }

  /**
   * Exports a workflow as a portable definition (no history or schedules).
   * @param {string} workflowName - Workflow name
   * @return {Object} `{ name, description, group, tags, steps, defaultInput, exportedAt }`
   */
  exportWorkflow(workflowName) {
    const w = this.getWorkflow(workflowName);
    return {
      name: w.name,
      description: w.description,
      group: w.group,
      tags: w.tags,
      steps: w.steps,
      defaultInput: w.defaultInput,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Imports a workflow previously produced by {@link exportWorkflow}.
   * @param {Object} data - Exported workflow
   * @param {Object} [options] - Import options
   * @param {boolean} [options.overwrite=false] - Replace an existing workflow of the same name
   * @return {Promise<Object>} The imported workflow view
   */
  async importWorkflow(data, options = {}) {
    this.validateWorkflowData_(data, false);
    const name = data.name.trim();
    if (this.definitionContainer.exists(name)) {
      if (!options.overwrite) throw httpError(`Workflow '${name}' already exists`, 409);
      return this.updateWorkflow(name, {
        steps: data.steps,
        description: data.description || '',
        tags: data.tags || [],
        group: data.group || null,
        defaultInput: data.defaultInput || null
      });
    }
    return this.createWorkflow(data);
  }

  // ===========================================================================
  // Execution management
  // ===========================================================================

  /**
   * Runs a workflow and resolves with its execution record. Unlike
   * {@link runWorkflow} a failed run does not reject - it resolves with the
   * failed record - so callers can treat every outcome uniformly.
   *
   * @param {string} workflowName - Workflow name
   * @param {Object} [input] - Input data; the workflow's defaultInput is used when empty
   * @param {Object} [options] - Run options
   * @param {string} [options.executionId] - Id to record the run under
   * @param {string} [options.trigger='manual'] - What started the run
   * @param {string} [options.scheduleId] - Schedule that started the run
   * @param {string} [options.scheduleName] - Name of that schedule
   * @return {Promise<Object>} The final execution record
   * @throws {Error} When the workflow does not exist (404) or no working service is available (503)
   *
   * @example
   * const execution = await workflow.executeWorkflow('nightly-ingest', { since: '2026-01-01' });
   * console.log(execution.outcome); // 'success' | 'failed' | 'cancelled'
   */
  async executeWorkflow(workflowName, input, options = {}) {
    const definition = this.requireWorkflow_(workflowName);
    if (!this.workingService_) {
      throw httpError('Working service not available', 503);
    }
    const defaultInput = definition.metadata && definition.metadata.defaultInput;
    const provided = isPlainObject(input) ? input : {};
    const runInput = Object.keys(provided).length === 0 && isPlainObject(defaultInput)
      ? { ...defaultInput }
      : provided;
    const executionId = options.executionId || crypto.randomUUID();

    try {
      return await this.runWorkflow(workflowName, runInput, () => {}, {
        executionId,
        trigger: options.trigger || 'manual',
        scheduleId: options.scheduleId,
        scheduleName: options.scheduleName
      });
    } catch (err) {
      const recorded = this.executionContainer.findById(executionId);
      if (recorded) return recorded;
      throw err;
    }
  }

  /**
   * Starts a workflow without waiting for it to finish.
   * @param {string} workflowName - Workflow name
   * @param {Object} [input] - Input data
   * @param {Object} [options] - Same as {@link executeWorkflow}
   * @return {{executionId: string, done: Promise<Object>}} The run's id and a promise of its final record
   * @throws {Error} When the workflow does not exist (404) or no working service is available (503)
   */
  startExecution(workflowName, input, options = {}) {
    this.requireWorkflow_(workflowName);
    if (!this.workingService_) {
      throw httpError('Working service not available', 503);
    }
    const executionId = options.executionId || crypto.randomUUID();
    const done = this.executeWorkflow(workflowName, input, { ...options, executionId });
    done.catch((err) => {
      this.logger?.error(`[${this.constructor.name}] Background execution failed`, {
        workflowName,
        executionId,
        error: err?.message
      });
    });
    return { executionId, done };
  }

  /**
   * Gets a full execution record by id.
   * @param {string} executionId - Execution id
   * @return {?Object} The execution, or null if not found
   */
  getExecution(executionId) {
    return this.executionContainer.findById(executionId);
  }

  /**
   * Lists execution summaries across workflows, newest first.
   *
   * @param {Object} [options] - Filters
   * @param {string} [options.workflowName] - Only this workflow
   * @param {string} [options.status] - success | failed | running | other, or a raw status
   * @param {string} [options.from] - Started at or after (ISO)
   * @param {string} [options.to] - Started at or before (ISO)
   * @param {string} [options.scheduleId] - Only runs started by this schedule
   * @param {number} [options.limit=100] - Page size
   * @param {number} [options.offset=0] - Page offset
   * @return {{executions: Array<Object>, total: number, limit: number, offset: number}}
   */
  listExecutions(options = {}) {
    const page = this.executionContainer.query(options);
    return { ...page, executions: summarizeExecutions(page.executions) };
  }

  /**
   * One workflow's execution history over a look-back window, with stats
   * describing the whole window (not just the returned page).
   *
   * @param {string} workflowName - Workflow name
   * @param {Object} [options] - Options
   * @param {number} [options.days=30] - Look-back window in days; 0 = all retained history
   * @param {number} [options.limit=200] - Rows returned
   * @param {string} [options.status] - Restrict rows to success | failed | running (stats stay whole-window)
   * @return {{workflow: Object, executions: Array<Object>, stats: Object, window: Object}}
   */
  listWorkflowExecutions(workflowName, options = {}) {
    const definition = this.definitionContainer.get(workflowName);
    const days = Number.isFinite(options.days) && options.days >= 0 ? options.days : 30;
    const limit = options.limit > 0 ? options.limit : 200;
    const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

    const filter = { workflowName, from };
    const stats = this.executionContainer.summarize(filter);
    const page = this.executionContainer.query({ ...filter, status: options.status, limit });

    return {
      workflow: {
        id: workflowName,
        name: workflowName,
        group: definition?.metadata?.group || null,
        exists: !!definition
      },
      executions: summarizeExecutions(page.executions),
      stats,
      window: {
        days: days > 0 ? days : null,
        from: from || null,
        to: new Date().toISOString(),
        limit,
        matched: page.total,
        truncated: page.total > page.executions.length,
        retainedPerWorkflow: this.executionContainer.maxExecutionsPerWorkflow
      }
    };
  }

  /**
   * Outcome statistics across executions.
   * @param {Object} [options] - Filters (workflowName, from, to, scheduleId)
   * @return {Object} `{ total, succeeded, failed, running, other, averageDuration, successRate, lastExecution }`
   */
  getExecutionStats(options = {}) {
    return this.executionContainer.summarize(options);
  }

  /**
   * The most recent run of every workflow that has one.
   * @return {Object<string, {executionId: string, status: string, outcome: string,
   *   startedAt: string, duration: number, trigger: string}>} Keyed by workflow name
   */
  getLastRuns() {
    const lastRuns = {};
    for (const name of this.executionContainer.executions.keys()) {
      const [latest] = this.executionContainer.query({ workflowName: name, limit: 1 }).executions;
      if (!latest) continue;
      lastRuns[name] = {
        executionId: latest.executionId,
        status: latest.status,
        outcome: latest.outcome,
        startedAt: latest.startedAt,
        duration: latest.duration,
        trigger: latest.trigger,
        error: summarizeExecution(latest).error || null
      };
    }
    return lastRuns;
  }

  /**
   * Asks a running execution to stop. Cancellation takes effect before the
   * next step starts; a step already running in a worker completes first.
   * @param {string} executionId - Execution id
   * @return {{cancelling: boolean, executionId: string}}
   * @throws {Error} When not found (404) or not running (409)
   */
  cancelExecution(executionId) {
    const execution = this.executionContainer.findById(executionId);
    if (!execution) throw httpError(`Execution '${executionId}' not found`, 404);
    if (classifyExecution(execution) !== 'running') {
      throw httpError(`Execution '${executionId}' is not running`, 409);
    }
    this.cancelRequests_.add(executionId);
    this.eventEmitter_?.emit('workflow:cancel-requested', {
      workflowName: execution.workflowName,
      executionId
    });
    return { cancelling: true, executionId };
  }

  /**
   * Deletes one execution record. Running executions cannot be deleted.
   * @param {string} executionId - Execution id
   * @return {boolean} True if deleted
   * @throws {Error} When not found (404) or still running (409)
   */
  deleteExecution(executionId) {
    const execution = this.executionContainer.findById(executionId);
    if (!execution) throw httpError(`Execution '${executionId}' not found`, 404);
    if (classifyExecution(execution) === 'running') {
      throw httpError(`Execution '${executionId}' is still running`, 409);
    }
    this.executionContainer.deleteById(executionId);
    this.notifyChange_('executions', { workflowName: execution.workflowName, executionId });
    return true;
  }

  /**
   * Clears finished execution history. Running executions are kept.
   * @param {Object} [options] - Options
   * @param {number} [options.olderThanDays] - Only runs started more than N days ago (omit or 0 for all)
   * @param {string} [options.workflowName] - Only this workflow's history
   * @return {number} Number of records removed
   */
  clearExecutions(options = {}) {
    const days = Number(options.olderThanDays);
    const before = Number.isFinite(days) && days > 0
      ? Date.now() - days * 24 * 60 * 60 * 1000
      : null;
    const deleted = this.executionContainer.deleteBefore(before, options.workflowName);
    if (deleted) this.notifyChange_('executions', { workflowName: options.workflowName || null });
    return deleted;
  }

  // ===========================================================================
  // Schedule management
  // ===========================================================================

  /**
   * Resolves and validates a schedule's cadence.
   * @param {Object} data - Candidate cronExpression / cron / interval
   * @return {{cronExpression: ?string, interval: ?number}}
   * @throws {Error} When neither or both are given, or either is invalid (400)
   * @private
   */
  resolveCadence_(data) {
    const cron = typeof (data.cronExpression ?? data.cron) === 'string'
      ? String(data.cronExpression ?? data.cron).trim()
      : '';
    const hasInterval = data.interval !== undefined && data.interval !== null && data.interval !== '';
    if (!cron && !hasInterval) throw httpError('Either cronExpression or interval is required', 400);
    if (cron && hasInterval) throw httpError('Give either cronExpression or interval, not both', 400);
    if (cron) {
      this.scheduler.validateCron(cron);
      return { cronExpression: cron, interval: null };
    }
    return { cronExpression: null, interval: this.scheduler.validateInterval(data.interval) };
  }

  /**
   * Adds the scheduler's live state to a schedule record.
   * @param {Object} schedule - Schedule record
   * @return {Object} Schedule view
   * @private
   */
  scheduleView_(schedule) {
    return {
      ...schedule,
      running: this.scheduler.isRunning(schedule.id),
      workflowExists: this.definitionContainer.exists(schedule.workflowName)
    };
  }

  /**
   * Creates a schedule that runs a workflow on a cron expression or interval.
   *
   * @param {Object} data - Schedule data
   * @param {string} data.workflowName - Workflow to run (`workflowId` is accepted as an alias)
   * @param {string} [data.name] - Display name (defaults to the workflow name)
   * @param {string} [data.cronExpression] - 5-field cron expression (`cron` is accepted as an alias)
   * @param {number} [data.interval] - Interval in milliseconds (instead of a cron expression)
   * @param {string} [data.description] - Description
   * @param {Object} [data.input] - Input passed to every run
   * @param {boolean} [data.enabled=true] - Whether the schedule fires
   * @return {Object} The created schedule
   * @throws {Error} On invalid input (400) or an unknown workflow (404)
   *
   * @example
   * workflow.createSchedule({ workflowName: 'nightly-ingest', cronExpression: '0 2 * * *' });
   */
  createSchedule(data) {
    if (!isPlainObject(data)) throw httpError('Schedule data must be an object', 400);
    const workflowName = data.workflowName || data.workflowId;
    if (!workflowName) throw httpError('workflowName is required', 400);
    this.requireWorkflow_(workflowName);
    if (data.input !== undefined && data.input !== null && !isPlainObject(data.input)) {
      throw httpError('input must be an object', 400);
    }
    const cadence = this.resolveCadence_(data);
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : workflowName;
    const enabled = data.enabled !== false;

    const schedule = this.scheduleContainer.create({
      workflowName,
      name,
      description: typeof data.description === 'string' ? data.description : '',
      ...cadence,
      input: data.input || {},
      enabled
    });
    const nextRun = enabled ? this.scheduler.nextRunFor(schedule) : null;
    this.scheduleContainer.update(schedule.id, { nextRun });

    this.scheduler.arm();
    this.notifyChange_('schedules', { scheduleId: schedule.id });
    this.eventEmitter_?.emit('workflow:schedule:created', { scheduleId: schedule.id, workflowName, name });
    return this.getSchedule(schedule.id);
  }

  /**
   * Gets a schedule by id.
   * @param {string} scheduleId - Schedule id
   * @return {Object} The schedule
   * @throws {Error} When not found (404)
   */
  getSchedule(scheduleId) {
    const schedule = this.scheduleContainer.get(scheduleId);
    if (!schedule) throw httpError(`Schedule '${scheduleId}' not found`, 404);
    return this.scheduleView_(schedule);
  }

  /**
   * Lists schedules, soonest next run first.
   * @param {Object} [options] - Filters
   * @param {string} [options.workflowName] - Only this workflow's schedules
   * @param {boolean} [options.enabled] - Only enabled (true) or paused (false)
   * @return {Array<Object>} Schedules
   */
  listSchedules(options = {}) {
    return this.scheduleContainer.list(options).map(s => this.scheduleView_(s));
  }

  /**
   * Updates a schedule. Changes are validated before anything is applied, so
   * a bad update never leaves a working schedule broken.
   *
   * @param {string} scheduleId - Schedule id
   * @param {Object} changes - Fields to change (name, description, cronExpression/cron, interval, input, enabled, workflowName)
   * @return {Object} The updated schedule
   * @throws {Error} When not found (404) or invalid (400)
   */
  updateSchedule(scheduleId, changes) {
    const current = this.getSchedule(scheduleId);
    if (!isPlainObject(changes)) throw httpError('Schedule changes must be an object', 400);

    const update = {};
    const cadenceChanged = changes.cronExpression !== undefined
      || changes.cron !== undefined
      || changes.interval !== undefined;
    if (cadenceChanged) {
      Object.assign(update, this.resolveCadence_(changes));
    }
    if (changes.name !== undefined) {
      if (typeof changes.name !== 'string' || !changes.name.trim()) {
        throw httpError('name must be a non-empty string', 400);
      }
      update.name = changes.name.trim();
    }
    if (changes.description !== undefined) update.description = String(changes.description || '');
    if (changes.input !== undefined) {
      if (changes.input !== null && !isPlainObject(changes.input)) throw httpError('input must be an object', 400);
      update.input = changes.input || {};
    }
    const workflowName = changes.workflowName || changes.workflowId;
    if (workflowName !== undefined && workflowName !== current.workflowName) {
      this.requireWorkflow_(workflowName);
      update.workflowName = workflowName;
    }
    if (changes.enabled !== undefined) update.enabled = !!changes.enabled;

    const enabled = update.enabled !== undefined ? update.enabled : current.enabled;
    const merged = { ...current, ...update };
    if (!enabled) {
      update.nextRun = null;
    } else if (cadenceChanged || (update.enabled && !current.enabled) || !current.nextRun) {
      // Re-arm from now: a nextRun frozen while paused would otherwise read
      // as a missed fire and replay immediately on enable.
      update.nextRun = this.scheduler.nextRunFor(merged);
    }

    this.scheduleContainer.update(scheduleId, update);
    this.scheduler.arm();
    this.notifyChange_('schedules', { scheduleId });
    this.eventEmitter_?.emit('workflow:schedule:updated', { scheduleId });
    return this.getSchedule(scheduleId);
  }

  /**
   * Enables or pauses a schedule.
   * @param {string} scheduleId - Schedule id
   * @param {boolean} enabled - New state
   * @return {Object} The updated schedule
   */
  setScheduleEnabled(scheduleId, enabled) {
    return this.updateSchedule(scheduleId, { enabled: !!enabled });
  }

  /**
   * Flips a schedule between enabled and paused.
   * @param {string} scheduleId - Schedule id
   * @return {Object} The updated schedule
   */
  toggleSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    return this.setScheduleEnabled(scheduleId, !schedule.enabled);
  }

  /**
   * Deletes a schedule. A run already in flight finishes normally.
   * @param {string} scheduleId - Schedule id
   * @return {boolean} True if deleted
   * @throws {Error} When not found (404)
   */
  deleteSchedule(scheduleId) {
    this.getSchedule(scheduleId);
    this.scheduleContainer.delete(scheduleId);
    this.scheduler.arm();
    this.notifyChange_('schedules', { scheduleId, deleted: true });
    this.eventEmitter_?.emit('workflow:schedule:deleted', { scheduleId });
    return true;
  }

  /**
   * Runs a schedule's workflow immediately with the schedule's input,
   * recording the run against the schedule. Does not move its nextRun.
   *
   * @param {string} scheduleId - Schedule id
   * @return {{scheduleId: string, done: Promise<?Object>}} A promise of the final execution record
   * @throws {Error} When not found (404), its workflow is missing (404) or already running (409)
   */
  runScheduleNow(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    this.requireWorkflow_(schedule.workflowName);
    if (this.scheduler.isRunning(scheduleId)) {
      throw httpError(`Schedule '${schedule.name}' already has a run in flight`, 409);
    }
    const done = this.scheduler.dispatch(scheduleId, { trigger: 'run-now' });
    return { scheduleId, done };
  }

  /**
   * Validates a cron expression and previews its next fire times.
   * @param {string} expression - 5-field cron expression
   * @param {number} [count=5] - Fire times to return
   * @return {{valid: boolean, error: ?string, nextRuns: Array<string>}}
   */
  previewCron(expression, count = 5) {
    return this.scheduler.previewCron(expression, Math.min(Math.max(Number(count) || 5, 1), 20));
  }

  /**
   * Summary counts across schedules.
   * @return {{total: number, enabled: number, paused: number, running: number,
   *   failing: number, totalExecutions: number, byType: {cron: number, interval: number}}}
   */
  getScheduleStats() {
    const all = this.listSchedules();
    return {
      total: all.length,
      enabled: all.filter(s => s.enabled).length,
      paused: all.filter(s => !s.enabled).length,
      running: all.filter(s => s.running).length,
      failing: all.filter(s => s.lastResult === 'failed').length,
      totalExecutions: all.reduce((sum, s) => sum + (s.executionCount || 0), 0),
      byType: {
        cron: all.filter(s => s.cronExpression).length,
        interval: all.filter(s => s.interval).length
      }
    };
  }

  // ===========================================================================
  // State export / import (persistence is the consuming application's job)
  // ===========================================================================

  /**
   * Exports the service's entire in-memory state as a JSON-compatible
   * snapshot. Save it wherever suits the application and pass it back to
   * {@link importState} (or `options.state`) on start-up.
   *
   * @param {Object} [options] - Export options
   * @param {boolean} [options.includeExecutions=true] - Include execution history
   * @return {{version: number, exportedAt: string, workflows: Object,
   *   workflowState: Object, schedules: Array<Object>, executions: Object}}
   *
   * @example
   * eventEmitter.on('workflow:state:changed', () => {
   *   store.save('workflow-state', workflow.exportState());
   * });
   */
  exportState(options = {}) {
    const workflowState = {};
    this.workflowState_.forEach((state, name) => { workflowState[name] = { ...state }; });
    return {
      version: STATE_VERSION,
      exportedAt: new Date().toISOString(),
      workflows: this.definitionContainer.export(),
      workflowState,
      schedules: this.scheduleContainer.export(),
      executions: options.includeExecutions === false ? {} : this.executionContainer.export()
    };
  }

  /**
   * Loads a snapshot produced by {@link exportState}. Items in the snapshot
   * replace same-named items already in memory; everything else is kept.
   *
   * Runs recorded as "running" in the snapshot cannot still be running in
   * this process, so they are imported as failed ("interrupted"). Enabled
   * schedules whose nextRun is already past are caught up (or just
   * re-armed when catch-up is off) on the scheduler's next tick.
   *
   * @param {Object} state - Snapshot from {@link exportState}
   * @return {{workflows: number, schedules: number, executions: number}} Counts imported
   * @throws {Error} When the snapshot is not an object (400)
   */
  importState(state) {
    if (!isPlainObject(state)) throw httpError('State must be an object', 400);
    const counts = { workflows: 0, schedules: 0, executions: 0 };

    if (isPlainObject(state.workflows)) {
      for (const [name, definition] of Object.entries(state.workflows)) {
        if (!definition || !Array.isArray(definition.steps) || definition.steps.length === 0) continue;
        const normalised = {
          name,
          steps: definition.steps,
          metadata: {
            description: '',
            tags: [],
            version: 1,
            ...(definition.metadata || {})
          }
        };
        this.definitionContainer.import({ [name]: normalised });
        this.workflows.set(name, definition.steps);
        counts.workflows++;
      }
    }

    if (isPlainObject(state.workflowState)) {
      for (const [name, value] of Object.entries(state.workflowState)) {
        if (isPlainObject(value)) {
          this.workflowState_.set(name, { starred: !!value.starred, lastViewed: value.lastViewed || null });
        }
      }
    }

    if (isPlainObject(state.executions)) {
      const interruptedAt = new Date().toISOString();
      const cleaned = {};
      for (const [name, list] of Object.entries(state.executions)) {
        if (!Array.isArray(list)) continue;
        cleaned[name] = list.map(e => (e && classifyExecution(e) === 'running'
          ? { ...e, status: 'error', endedAt: e.endedAt || interruptedAt, error: e.error || 'Interrupted: the process stopped while this run was in flight' }
          : e));
        counts.executions += cleaned[name].length;
      }
      this.executionContainer.import(cleaned);
    }

    if (Array.isArray(state.schedules)) {
      counts.schedules = this.scheduleContainer.import(state.schedules);
      for (const schedule of this.scheduleContainer.list()) {
        if (!schedule.enabled) {
          if (schedule.nextRun) this.scheduleContainer.update(schedule.id, { nextRun: null });
        } else if (!schedule.nextRun) {
          this.scheduleContainer.update(schedule.id, { nextRun: this.scheduler.nextRunFor(schedule) });
        }
      }
    }

    this.scheduler.arm();
    this.eventEmitter_?.emit('workflow:state:imported', counts);
    return counts;
  }

  /**
   * Stops the schedule timer. Runs in flight finish normally; call this in
   * test teardown and process shutdown handlers.
   */
  shutdown() {
    this.scheduler.stop();
  }

  /**
   * Alias of {@link shutdown} for test harnesses that call `cleanup()`.
   */
  cleanup() {
    this.shutdown();
  }
}

/**
 * Creates a workflow service instance with the specified configuration and dependency injection.
 * Automatically configures routes and views for the workflow service.
 * @param {string} type - The workflow provider type ('memory', 'api')
 * @param {Object} options - Provider-specific configuration options
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {Object} options.dependencies.queueing - Queueing service instance
 * @param {Object} options.dependencies.scheduling - Scheduling service instance
 * @param {Object} options.dependencies.measuring - Measuring service instance
 * @param {Object} options.dependencies.working - Working service instance for task execution
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {WorkflowService|WorkflowApi} Workflow service instance
 * @throws {Error} When required dependencies (especially working service) are missing
 * @example
 * const workflowService = createWorkflowService('memory', {
 *   dependencies: { logging, queueing, scheduling, measuring, working }
 * }, eventEmitter);
 *
 * // Define a workflow with multiple steps
 * await workflowService.defineWorkflow('order_processing', [
 *   '/path/to/steps/validate_order.js',
 *   '/path/to/steps/charge_payment.js',
 *   '/path/to/steps/send_confirmation.js'
 * ]);
 *
 * // Execute the workflow
 * await workflowService.runWorkflow('order_processing', { orderId: 123 }, (status) => {
 *   console.log('Workflow status:', status);
 * });
 */
function createWorkflowService(type, options, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;
  const queueing = dependencies.queueing;
  const scheduling = dependencies.scheduling;
  const measuring = dependencies.measuring;
  const working = dependencies.working;

  // Create analytics instance if it doesn't exist
  if (!analyticsInstance) {
    analyticsInstance = new WorkflowAnalytics(eventEmitter);
  }

  let workflow;

  switch (type) {
    case 'api':
      workflow = new WorkflowApi(providerOptions, eventEmitter);
      break;
    case 'memory':
    default:
      workflow = new WorkflowService(eventEmitter, working, providerOptions);
      break;
  }

  // Inject dependencies into workflow service
  if (logger) {
    workflow.logger = logger;
    if (workflow.scheduler) workflow.scheduler.logger = logger;
    workflow.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[WORKFLOW:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    // Log workflow service initialization
    workflow.log('info', 'Workflow service initialized', {
      provider: type,
      hasLogging: true,
      hasQueueing: !!queueing,
      hasScheduling: !!scheduling,
      hasMeasuring: !!measuring,
      hasWorking: !!working
    });
  }

  // Inject queueing dependency for async workflow execution
  if (queueing) {
    workflow.queueing = queueing;
  }

  // Inject scheduling dependency for timed workflows
  if (scheduling) {
    workflow.scheduling = scheduling;
  }

  // Inject measuring dependency for performance metrics
  if (measuring) {
    workflow.measuring = measuring;
  }

  // Inject working service for task execution
  if (working) {
    workflow.workingService_ = working;
  }

  // Store all dependencies for potential use by workflow steps
  workflow.dependencies = dependencies;

  // Initialize routes and views for the workflow service
  Routes(options, eventEmitter, workflow, analyticsInstance);
  Views(options, eventEmitter, workflow);
  Scripts(options, eventEmitter, workflow);

  // Expose settings methods (only for memory provider, API provider has its own implementation)
  if (type !== 'api' && workflow.getSettings && workflow.saveSettings) {
    // Save provider methods before overwriting
    const providerGetSettings = workflow.getSettings.bind(workflow);
    const providerSaveSettings = workflow.saveSettings.bind(workflow);
    const service = workflow;
    service.getSettings = providerGetSettings;
    service.saveSettings = providerSaveSettings;
  }

  return workflow;
}

module.exports = createWorkflowService;
