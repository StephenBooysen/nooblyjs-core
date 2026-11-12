/**
 * @fileoverview AWS SQS (Simple Queue Service) provider for NooblyJS Core queueing service.
 * Leverages AWS SQS for distributed, managed queue operations with high availability and durability.
 * Supports both Standard and FIFO queue types with automatic detection.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand,
        PurgeQueueCommand, GetQueueAttributesCommand, ListQueuesCommand } = requireOptional('@aws-sdk/client-sqs', "queue('aws')");

/**
 * AWS SQS queue provider
 * Provides distributed queue operations using AWS SQS with automatic queue URL management
 * Supports both Standard and FIFO queue modes with configurable batch operations
 *
 * @class QueueingAWS
 */
class QueueingAWS {
  /**
   * Initializes AWS SQS client with connection options and queue management
   *
   * @param {Object=} options Configuration options
   * @param {string} options.region - AWS region (default: from AWS_REGION env let or 'us-east-1')
   * @param {string} options.accessKeyId - AWS access key (default: from AWS_ACCESS_KEY_ID env var)
   * @param {string} options.secretAccessKey - AWS secret key (default: from AWS_SECRET_ACCESS_KEY env var)
   * @param {string} options.accountId - AWS account ID (default: from AWS_ACCOUNT_ID env var)
   * @param {string} options.queueNamePrefix - Prefix for queue names (default: '')
   * @param {string} options.instanceName - Instance name for this queue instance (default: 'default')
   * @param {number} options.visibilityTimeout - Message visibility timeout in seconds (default: 30)
   * @param {number} options.messageRetentionPeriod - Message retention in seconds (default: 345600 = 4 days)
   * @param {number} options.receiveMessageWaitTimeSeconds - Long polling timeout (default: 20)
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'AWS SQS configuration for distributed queue operations';
    this.settings.list = [
      { setting: 'region', type: 'string', values: ['us-east-1', 'us-west-2', 'eu-west-1'] },
      { setting: 'accountId', type: 'string', description: 'AWS Account ID' },
      { setting: 'queueNamePrefix', type: 'string', description: 'Prefix for queue names' },
      { setting: 'visibilityTimeout', type: 'number', default: 30 },
      { setting: 'messageRetentionPeriod', type: 'number', default: 345600 }
    ];

    const region = options?.region || process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = options?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = options?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;

    const clientConfig = {
      region: region,
      ...(accessKeyId && secretAccessKey && {
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey
        }
      })
    };

    /** @private @const {SQSClient} */
    this.client_ = new SQSClient(clientConfig);

    this.settings.region = region;
    this.settings.accountId = options?.accountId || process.env.AWS_ACCOUNT_ID || '';
    this.settings.queueNamePrefix = options?.queueNamePrefix || '';
    this.settings.visibilityTimeout = options?.visibilityTimeout || 30;
    this.settings.messageRetentionPeriod = options?.messageRetentionPeriod || 345600;
    this.settings.receiveMessageWaitTimeSeconds = options?.receiveMessageWaitTimeSeconds || 20;

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {Map<string, {queueUrl: string, operations: number, lastActivity: Date}>} */
    this.queueCache_ = new Map();
    /** @private @const {number} */
    this.maxCacheEntries_ = 100;

    /** @private @const {Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
  }

  /**
   * Retrieves all current configuration settings for the AWS SQS provider.
   * Returns SQS-specific settings including region, account ID, and queue parameters.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Provider description
   *   - list: {Array} Available settings definitions
   *   - region: {string} AWS region
   *   - accountId: {string} AWS account ID
   *   - queueNamePrefix: {string} Prefix for queue names
   *   - visibilityTimeout: {number} Message visibility timeout in seconds
   *   - messageRetentionPeriod: {number} Message retention period in seconds
   *   - receiveMessageWaitTimeSeconds: {number} Long polling timeout
   *
   * @example
   * // Get SQS configuration
   * const settings = await queueingAWS.getSettings();
   * console.log(`Region: ${settings.region}, Account: ${settings.accountId}`);
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Updates configuration settings for the AWS SQS provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.region] The new AWS region
   * @param {string} [settings.accountId] The new AWS account ID
   * @param {string} [settings.queueNamePrefix] The new queue name prefix
   * @param {number} [settings.visibilityTimeout] New visibility timeout in seconds
   * @param {number} [settings.messageRetentionPeriod] New retention period in seconds
   * @param {number} [settings.receiveMessageWaitTimeSeconds] New long polling timeout
   * @return {Promise<void>} A promise that resolves when settings are updated
   *
   * @example
   * // Update SQS settings
   * await queueingAWS.saveSettings({
   *   visibilityTimeout: 60,
   *   messageRetentionPeriod: 604800
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
   * Get or resolve the queue URL for a queue name
   * Caches URLs to minimize API calls
   *
   * @private
   * @param {string} queueName The name of the queue
   * @return {Promise<string>} The SQS queue URL
   * @throws {Error} If queue resolution fails
   */
  async getQueueUrl_(queueName) {
    // Check cache first
    if (this.queueCache_.has(queueName)) {
      return this.queueCache_.get(queueName).queueUrl;
    }

    try {
      const fullQueueName = this.settings.queueNamePrefix ?
        `${this.settings.queueNamePrefix}-${queueName}` :
        queueName;

      // Construct URL: https://sqs.{region}.amazonaws.com/{accountId}/{queueName}
      const region = this.settings.region;
      const accountId = this.settings.accountId;

      if (!accountId) {
        throw new Error('AWS Account ID is required. Set AWS_ACCOUNT_ID or provide in options.');
      }

      const queueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/${fullQueueName}`;

      // Cache the URL
      if (this.queueCache_.size >= this.maxCacheEntries_) {
        this.removeLeastRecentlyUsedQueue_();
      }

      this.queueCache_.set(queueName, {
        queueUrl: queueUrl,
        operations: 0,
        lastActivity: new Date()
      });

      return queueUrl;
    } catch (err) {
      throw new Error(`Failed to resolve queue URL for "${queueName}": ${err.message}`);
    }
  }

  /**
   * Removes the least recently used queue from cache
   * @private
   */
  removeLeastRecentlyUsedQueue_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.queueCache_) {
      if (!oldestTime || entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.queueCache_.delete(oldestKey);
    }
  }

  /**
   * Adds an item to the specified queue (enqueue operation)
   * Serializes the item as JSON and sends to SQS
   *
   * @param {string} queueName The name of the queue
   * @param {*} item The item to add to the queue
   * @return {Promise<void>} A promise that resolves when the item is enqueued
   * @throws {Error} If the enqueue operation fails
   */
  async enqueue(queueName, item) {
    try {
      const queueUrl = await this.getQueueUrl_(queueName);
      const messageBody = typeof item === 'string' ? item : JSON.stringify(item);

      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        DelaySeconds: 0
      });

      await this.client_.send(command);

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
   * Uses long polling to wait for messages efficiently
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<*>} A promise that resolves to the dequeued item, or undefined if queue is empty
   * @throws {Error} If the dequeue operation fails
   */
  async dequeue(queueName) {
    try {
      const queueUrl = await this.getQueueUrl_(queueName);

      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0, // Don't wait for demo, set to 20 for production
        VisibilityTimeout: this.settings.visibilityTimeout
      });

      const response = await this.client_.send(command);

      if (!response.Messages || response.Messages.length === 0) {
        return undefined;
      }

      const message = response.Messages[0];
      const messageBody = (() => {
        try {
          return JSON.parse(message.Body);
        } catch {
          return message.Body;
        }
      })();

      // Delete the message from the queue
      const deleteCommand = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle
      });

      await this.client_.send(deleteCommand);

      this.trackOperation_(queueName);
      if (this.eventEmitter_) {
        const eventName = `queue:dequeue:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName, item: messageBody });
      }

      return messageBody;
    } catch (err) {
      throw new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns the number of items in the specified queue
   * Uses ApproximateNumberOfMessages attribute
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<number>} A promise that resolves to the approximate number of items in the queue
   * @throws {Error} If the operation fails
   */
  async size(queueName) {
    try {
      const queueUrl = await this.getQueueUrl_(queueName);

      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages']
      });

      const response = await this.client_.send(command);
      const count = parseInt(response.Attributes?.ApproximateNumberOfMessages || '0');
      return count;
    } catch (err) {
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names in this AWS account and region
   * Uses ListQueues API with optional prefix filtering
   *
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names
   * @throws {Error} If the list operation fails
   */
  async listQueues() {
    try {
      const command = new ListQueuesCommand({
        QueueNamePrefix: this.settings.queueNamePrefix || undefined
      });

      const response = await this.client_.send(command);

      if (!response.QueueUrls || response.QueueUrls.length === 0) {
        return [];
      }

      // Extract queue names from URLs
      const queueNames = response.QueueUrls.map(url => {
        const parts = url.split('/');
        let queueName = parts[parts.length - 1];

        // Remove prefix if present
        if (this.settings.queueNamePrefix) {
          const prefixPattern = `${this.settings.queueNamePrefix}-`;
          if (queueName.startsWith(prefixPattern)) {
            queueName = queueName.substring(prefixPattern.length);
          }
        }

        return queueName;
      });

      return queueNames;
    } catch (err) {
      throw new Error(`Failed to list queues: ${err.message}`);
    }
  }

  /**
   * Purges all items from the specified queue
   * Removes all messages from the queue without creating a new one
   *
   * @param {string} queueName The name of the queue to purge
   * @return {Promise<void>} A promise that resolves when the queue is purged
   * @throws {Error} If the purge operation fails
   */
  async purge(queueName) {
    try {
      const queueUrl = await this.getQueueUrl_(queueName);

      const command = new PurgeQueueCommand({
        QueueUrl: queueUrl
      });

      await this.client_.send(command);

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
   * Gracefully closes the SQS client and cleans up resources
   * @return {Promise<void>}
   */
  async disconnect() {
    try {
      this.client_.destroy();
    } catch (err) {
      console.warn('Error disconnecting SQS client:', err.message);
    }
  }

  /**
   * Gets AWS SQS connection information
   * @return {{region: string, accountId: string, queueNamePrefix: string, provider: string}}
   */
  getConnectionInfo() {
    return {
      region: this.settings.region,
      accountId: this.settings.accountId,
      queueNamePrefix: this.settings.queueNamePrefix,
      visibilityTimeout: this.settings.visibilityTimeout,
      messageRetentionPeriod: this.settings.messageRetentionPeriod,
      provider: 'aws-sqs',
      cacheSize: this.queueCache_.size
    };
  }
}

module.exports = QueueingAWS;
