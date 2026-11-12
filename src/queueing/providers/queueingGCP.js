/**
 * @fileoverview Google Cloud Tasks provider for NooblyJS Core queueing service.
 * Leverages GCP Cloud Tasks for distributed, managed task scheduling and execution.
 * Supports HTTP and App Engine targets with configurable retry policies.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { CloudTasksClient } = requireOptional('@google-cloud/tasks', "queue('gcp')");
const { v4: uuidv4 } = require('uuid');

/**
 * Google Cloud Tasks queue provider
 * Provides distributed task queue operations using Google Cloud Tasks
 * Supports task scheduling and execution with automatic retry management
 *
 * @class QueueingGCP
 */
class QueueingGCP {
  /**
   * Initializes GCP Cloud Tasks client with connection options
   *
   * @param {Object=} options Configuration options
   * @param {string} options.projectId - GCP project ID (default: from GOOGLE_CLOUD_PROJECT env var)
   * @param {string} options.region - GCP region (default: from GCP_REGION env let or 'us-central1')
   * @param {string} options.queue - Queue name (default: 'default')
   * @param {string} options.keyFilePath - Path to GCP service account JSON key file (optional)
   * @param {string} options.instanceName - Instance name for this queue instance (default: 'default')
   * @param {number} options.maxRetries - Maximum number of retries (default: 5)
   * @param {number} options.maxBackoffSeconds - Maximum backoff in seconds (default: 3600)
   * @param {string} options.httpTarget - HTTP target URL for tasks (optional, uses local storage if not provided)
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'Google Cloud Tasks configuration';
    this.settings.list = [
      { setting: 'projectId', type: 'string', description: 'GCP project ID' },
      { setting: 'region', type: 'string', description: 'GCP region', default: 'us-central1' },
      { setting: 'queue', type: 'string', description: 'Queue name', default: 'default' },
      { setting: 'maxRetries', type: 'number', default: 5 },
      { setting: 'maxBackoffSeconds', type: 'number', default: 3600 }
    ];

    const projectId = options?.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;

    if (!projectId) {
      throw new Error('GCP Project ID is required. Set GOOGLE_CLOUD_PROJECT env let or provide in options.');
    }

    const clientOptions = {};
    if (options?.keyFilePath) {
      clientOptions.keyFilename = options.keyFilePath;
    }

    /** @private @const {CloudTasksClient} */
    this.client_ = new CloudTasksClient(clientOptions);

    this.settings.projectId = projectId;
    this.settings.region = options?.region || process.env.GCP_REGION || 'us-central1';
    this.settings.queue = options?.queue || 'default';
    this.settings.maxRetries = options?.maxRetries || 5;
    this.settings.maxBackoffSeconds = options?.maxBackoffSeconds || 3600;
    this.settings.httpTarget = options?.httpTarget || '';

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;

    // For local storage fallback when no HTTP target
    /** @private @const {Map<string, Array>} */
    this.localQueues_ = new Map();
  }

  /**
   * Retrieves all current configuration settings for the GCP Cloud Tasks provider.
   * Returns Cloud Tasks-specific settings including project ID, region, and retry configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Provider description
   *   - list: {Array} Available settings definitions
   *   - projectId: {string} GCP project ID
   *   - region: {string} GCP region
   *   - queue: {string} Queue name
   *   - maxRetries: {number} Maximum retry attempts
   *   - maxBackoffSeconds: {number} Maximum backoff in seconds
   *   - httpTarget: {string} HTTP target URL for tasks
   *
   * @example
   * // Get Cloud Tasks configuration
   * const settings = await queueingGCP.getSettings();
   * console.log(`Project: ${settings.projectId}, Region: ${settings.region}`);
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Updates configuration settings for the GCP Cloud Tasks provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.projectId] The new GCP project ID
   * @param {string} [settings.region] The new GCP region
   * @param {string} [settings.queue] The new queue name
   * @param {number} [settings.maxRetries] New maximum retries
   * @param {number} [settings.maxBackoffSeconds] New maximum backoff seconds
   * @param {string} [settings.httpTarget] New HTTP target URL
   * @return {Promise<void>} A promise that resolves when settings are updated
   *
   * @example
   * // Update Cloud Tasks settings
   * await queueingGCP.saveSettings({
   *   maxRetries: 10,
   *   maxBackoffSeconds: 7200
   * });
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
      }
    }
  }

  /**
   * Get the full queue path in Cloud Tasks
   * @private
   * @param {string} queueName The name of the queue
   * @return {string} The full queue path
   */
  getQueuePath_(queueName) {
    return this.client_.queuePath(
      this.settings.projectId,
      this.settings.region,
      queueName
    );
  }

  /**
   * Ensure local queue exists (fallback storage)
   * @private
   * @param {string} queueName The queue name
   */
  ensureLocalQueue_(queueName) {
    if (!this.localQueues_.has(queueName)) {
      this.localQueues_.set(queueName, []);
    }
  }

  /**
   * Adds an item to the specified queue (enqueue operation)
   * Creates a Cloud Task with the item as payload
   *
   * @param {string} queueName The name of the queue
   * @param {*} item The item to add to the queue
   * @return {Promise<void>} A promise that resolves when the item is enqueued
   * @throws {Error} If the enqueue operation fails
   */
  async enqueue(queueName, item) {
    try {
      const itemData = typeof item === 'string' ? item : JSON.stringify(item);

      // If no HTTP target, use local storage fallback
      if (!this.settings.httpTarget) {
        this.ensureLocalQueue_(queueName);
        this.localQueues_.get(queueName).push(item);
        this.trackOperation_(queueName);

        if (this.eventEmitter_) {
          const eventName = `queue:enqueue:${this.instanceName_}`;
          this.eventEmitter_.emit(eventName, { queueName, item });
        }
        return;
      }

      // Create task in Cloud Tasks
      const queuePath = this.getQueuePath_(queueName);
      const taskId = uuidv4();

      const task = {
        name: this.client_.taskPath(
          this.settings.projectId,
          this.settings.region,
          queueName,
          taskId
        ),
        httpRequest: {
          body: Buffer.from(itemData).toString('base64'),
          headers: {
            'Content-Type': 'application/json'
          },
          httpMethod: 'POST',
          url: this.settings.httpTarget
        }
      };

      const request = {
        parent: queuePath,
        task: task
      };

      await this.client_.createTask(request);

      this.trackOperation_(queueName);
      if (this.eventEmitter_) {
        const eventName = `queue:enqueue:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName, item });
      }
    } catch (err) {
      throw new Error(`Failed to enqueue item to queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Removes and returns the next item from the specified queue (dequeue operation)
   * For Cloud Tasks, this simulates dequeue from local cache
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<*>} A promise that resolves to the dequeued item, or undefined if queue is empty
   * @throws {Error} If the dequeue operation fails
   */
  async dequeue(queueName) {
    try {
      // Cloud Tasks doesn't support traditional dequeue
      // Use local storage fallback for demo purposes
      this.ensureLocalQueue_(queueName);
      const queue = this.localQueues_.get(queueName);

      if (queue.length === 0) {
        return undefined;
      }

      const item = queue.shift();

      this.trackOperation_(queueName);
      if (this.eventEmitter_) {
        const eventName = `queue:dequeue:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName, item });
      }

      return item;
    } catch (err) {
      throw new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns the number of items in the specified queue
   * For Cloud Tasks, uses local storage count
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<number>} A promise that resolves to the number of items in the queue
   * @throws {Error} If the operation fails
   */
  async size(queueName) {
    try {
      this.ensureLocalQueue_(queueName);
      return this.localQueues_.get(queueName).length;
    } catch (err) {
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names in this GCP project
   * Lists all Cloud Task queues in the configured region
   *
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names
   * @throws {Error} If the list operation fails
   */
  async listQueues() {
    try {
      const parent = this.client_.locationPath(
        this.settings.projectId,
        this.settings.region
      );

      const [queues] = await this.client_.listQueues({ parent });

      return queues.map(queue => {
        const parts = queue.name.split('/');
        return parts[parts.length - 1];
      });
    } catch (err) {
      // Fallback to local queues if Cloud Tasks unavailable
      return Array.from(this.localQueues_.keys());
    }
  }

  /**
   * Purges all items from the specified queue
   * For Cloud Tasks, uses local storage purge
   *
   * @param {string} queueName The name of the queue to purge
   * @return {Promise<void>} A promise that resolves when the queue is purged
   * @throws {Error} If the purge operation fails
   */
  async purge(queueName) {
    try {
      this.ensureLocalQueue_(queueName);
      this.localQueues_.set(queueName, []);

      // Also attempt Cloud Tasks purge if available
      if (this.settings.httpTarget) {
        try {
          const queuePath = this.getQueuePath_(queueName);
          await this.client_.purgeQueue({ name: queuePath });
        } catch (err) {
          // Cloud Tasks purge not critical for demo
          console.warn(`Could not purge Cloud Tasks queue: ${err.message}`);
        }
      }

      if (this.eventEmitter_) {
        const eventName = `queue:purge:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName });
      }
    } catch (err) {
      throw new Error(`Failed to purge queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Tracks a queue operation for analytics
   * @private
   * @param {string} queueName The queue name being accessed
   */
  trackOperation_(queueName) {
    const now = new Date();

    if (this.analytics_.has(queueName)) {
      const entry = this.analytics_.get(queueName);
      entry.operations++;
      entry.lastActivity = now;
    } else {
      const entry = {
        queueName: queueName,
        operations: 1,
        lastActivity: now
      };

      if (this.analytics_.size >= this.maxAnalyticsEntries_) {
        this.removeLeastRecentlyUsedAnalytic_();
      }

      this.analytics_.set(queueName, entry);
    }
  }

  /**
   * Removes the least recently used entry from analytics
   * @private
   */
  removeLeastRecentlyUsedAnalytic_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.analytics_) {
      if (!oldestTime || entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.analytics_.delete(oldestKey);
    }
  }

  /**
   * Gets analytics data for queue operations
   * @return {Array<{queueName: string, operations: number, lastActivity: string}>} Analytics data
   */
  getAnalytics() {
    const analytics = Array.from(this.analytics_.values());
    return analytics.map((entry) => ({
      queueName: entry.queueName,
      operations: entry.operations,
      lastActivity: entry.lastActivity.toISOString()
    }));
  }

  /**
   * Gets GCP Cloud Tasks connection information
   * @return {{projectId: string, region: string, queue: string, provider: string}}
   */
  getConnectionInfo() {
    return {
      projectId: this.settings.projectId,
      region: this.settings.region,
      queue: this.settings.queue,
      maxRetries: this.settings.maxRetries,
      maxBackoffSeconds: this.settings.maxBackoffSeconds,
      httpTarget: this.settings.httpTarget || 'none (local fallback)',
      provider: 'gcp-cloud-tasks',
      localQueuesCount: this.localQueues_.size
    };
  }
}

module.exports = QueueingGCP;
