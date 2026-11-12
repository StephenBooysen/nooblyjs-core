/**
 * @fileoverview Azure Queue Storage provider for NooblyJS Core queueing service.
 * Leverages Azure Queue Storage for distributed, serverless queue operations.
 * Provides FIFO queue behavior with automatic message expiration and retention.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.15
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { QueueClient, QueueServiceClient } = requireOptional('@azure/storage-queue', "queue('azure')");

/**
 * Azure Queue Storage provider
 * Provides distributed queue operations using Azure Queue Storage with automatic queue management
 * Supports configurable message retention and visibility timeout
 *
 * @class QueueingAzure
 */
class QueueingAzure {
  /**
   * Initializes Azure Queue Storage client with connection options
   *
   * @param {Object=} options Configuration options
   * @param {string} options.connectionString - Azure Storage connection string (default: from AZURE_STORAGE_CONNECTION_STRING env var)
   * @param {string} options.accountName - Azure Storage account name (default: from AZURE_STORAGE_ACCOUNT_NAME env var)
   * @param {string} options.accountKey - Azure Storage account key (default: from AZURE_STORAGE_ACCOUNT_KEY env var)
   * @param {string} options.queueNamePrefix - Prefix for queue names (default: '')
   * @param {string} options.instanceName - Instance name for this queue instance (default: 'default')
   * @param {number} options.visibilityTimeout - Message visibility timeout in seconds (default: 30)
   * @param {number} options.messageTimeToLive - Message TTL in seconds (default: 604800 = 7 days)
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'Azure Queue Storage configuration';
    this.settings.list = [
      { setting: 'accountName', type: 'string', description: 'Azure Storage account name' },
      { setting: 'queueNamePrefix', type: 'string', description: 'Prefix for queue names' },
      { setting: 'visibilityTimeout', type: 'number', default: 30 },
      { setting: 'messageTimeToLive', type: 'number', default: 604800 }
    ];

    const connectionString = options?.connectionString || process.env.AZURE_STORAGE_CONNECTION_STRING;

    if (!connectionString) {
      throw new Error('Azure Storage connection string is required. Set AZURE_STORAGE_CONNECTION_STRING env let or provide in options.');
    }

    /** @private @const {QueueServiceClient} */
    this.serviceClient_ = QueueServiceClient.fromConnectionString(connectionString);

    this.settings.accountName = options?.accountName || process.env.AZURE_STORAGE_ACCOUNT_NAME || 'default';
    this.settings.queueNamePrefix = options?.queueNamePrefix || '';
    this.settings.visibilityTimeout = options?.visibilityTimeout || 30;
    this.settings.messageTimeToLive = options?.messageTimeToLive || 604800;

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {Map<string, QueueClient>} */
    this.queueClients_ = new Map();

    /** @private @const {Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
  }

  /**
   * Retrieves all current configuration settings for the Azure Queue Storage provider.
   * Returns Azure-specific settings including account name, queue prefix, and message parameters.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Provider description
   *   - list: {Array} Available settings definitions
   *   - accountName: {string} Azure Storage account name
   *   - queueNamePrefix: {string} Prefix for queue names
   *   - visibilityTimeout: {number} Message visibility timeout in seconds
   *   - messageTimeToLive: {number} Message TTL in seconds
   *
   * @example
   * // Get Azure Queue Storage configuration
   * const settings = await queueingAzure.getSettings();
   * console.log(`Account: ${settings.accountName}`);
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Updates configuration settings for the Azure Queue Storage provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.accountName] The new Azure Storage account name
   * @param {string} [settings.queueNamePrefix] The new queue name prefix
   * @param {number} [settings.visibilityTimeout] New visibility timeout in seconds
   * @param {number} [settings.messageTimeToLive] New message TTL in seconds
   * @return {Promise<void>} A promise that resolves when settings are updated
   *
   * @example
   * // Update Azure Queue Storage settings
   * await queueingAzure.saveSettings({
   *   visibilityTimeout: 60,
   *   messageTimeToLive: 604800
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
   * Set all our settings
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
      }
    }
  }

  /**
   * Get or create a queue client for the specified queue name
   * Azure queue names must be lowercase and can contain only letters, numbers, and hyphens
   *
   * @private
   * @param {string} queueName The name of the queue
   * @return {Promise<QueueClient>} The Azure queue client
   */
  async getQueueClient_(queueName) {
    // Check cache first
    if (this.queueClients_.has(queueName)) {
      return this.queueClients_.get(queueName);
    }

    try {
      // Azure queue names must be lowercase and contain only alphanumeric and hyphens
      let fullQueueName = this.settings.queueNamePrefix ?
        `${this.settings.queueNamePrefix}-${queueName}` :
        queueName;

      // Sanitize queue name for Azure compliance
      fullQueueName = fullQueueName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      const queueClient = this.serviceClient_.getQueueClient(fullQueueName);

      // Create queue if it doesn't exist
      try {
        await queueClient.createIfNotExists();
      } catch (err) {
        // Queue might already exist, continue
        if (!err.message.includes('AlreadyExists') && !err.message.includes('QueueAlreadyExists')) {
          throw err;
        }
      }

      // Cache the client
      this.queueClients_.set(queueName, queueClient);

      return queueClient;
    } catch (err) {
      throw new Error(`Failed to get queue client for "${queueName}": ${err.message}`);
    }
  }

  /**
   * Adds an item to the specified queue (enqueue operation)
   * Serializes the item as JSON and sends to Azure Queue Storage
   *
   * @param {string} queueName The name of the queue
   * @param {*} item The item to add to the queue
   * @return {Promise<void>} A promise that resolves when the item is enqueued
   * @throws {Error} If the enqueue operation fails
   */
  async enqueue(queueName, item) {
    try {
      const queueClient = await this.getQueueClient_(queueName);
      const messageText = typeof item === 'string' ? item : JSON.stringify(item);

      // Azure Queue Storage has a 64KB message size limit
      if (messageText.length > 65536) {
        throw new Error(`Message exceeds 64KB limit: ${messageText.length} bytes`);
      }

      await queueClient.sendMessage(messageText);

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
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<*>} A promise that resolves to the dequeued item, or undefined if queue is empty
   * @throws {Error} If the dequeue operation fails
   */
  async dequeue(queueName) {
    try {
      const queueClient = await this.getQueueClient_(queueName);

      const response = await queueClient.receiveMessages({
        numberOfMessages: 1,
        visibilityTimeout: this.settings.visibilityTimeout
      });

      if (!response.receivedMessageItems || response.receivedMessageItems.length === 0) {
        return undefined;
      }

      const message = response.receivedMessageItems[0];
      const messageBody = (() => {
        try {
          return JSON.parse(message.messageText);
        } catch {
          return message.messageText;
        }
      })();

      // Delete the message from the queue
      await queueClient.deleteMessage(message.messageId, message.popReceipt);

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
   * Uses ApproximateMessageCount from queue properties
   *
   * @param {string} queueName The name of the queue
   * @return {Promise<number>} A promise that resolves to the approximate number of items in the queue
   * @throws {Error} If the operation fails
   */
  async size(queueName) {
    try {
      const queueClient = await this.getQueueClient_(queueName);
      const properties = await queueClient.getProperties();
      return properties.approximateMessagesCount || 0;
    } catch (err) {
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names in this Azure Storage account
   * Filters by prefix if configured
   *
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names
   * @throws {Error} If the list operation fails
   */
  async listQueues() {
    try {
      const queues = [];

      for await (const queueItem of this.serviceClient_.listQueues()) {
        let queueName = queueItem.name;

        // Remove prefix if present
        if (this.settings.queueNamePrefix) {
          const prefixPattern = `${this.settings.queueNamePrefix.toLowerCase()}-`;
          if (queueName.startsWith(prefixPattern)) {
            queueName = queueName.substring(prefixPattern.length);
          }
        }

        queues.push(queueName);
      }

      return queues;
    } catch (err) {
      throw new Error(`Failed to list queues: ${err.message}`);
    }
  }

  /**
   * Purges all items from the specified queue
   * Clears all messages without deleting the queue itself
   *
   * @param {string} queueName The name of the queue to purge
   * @return {Promise<void>} A promise that resolves when the queue is purged
   * @throws {Error} If the purge operation fails
   */
  async purge(queueName) {
    try {
      const queueClient = await this.getQueueClient_(queueName);

      // Get all messages and delete them
      let moreMessages = true;
      while (moreMessages) {
        const response = await queueClient.receiveMessages({
          numberOfMessages: 32 // Max per request
        });

        if (response.receivedMessageItems && response.receivedMessageItems.length > 0) {
          for (const message of response.receivedMessageItems) {
            await queueClient.deleteMessage(message.messageId, message.popReceipt);
          }
        } else {
          moreMessages = false;
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
   * Gets Azure Queue Storage connection information
   * @return {{accountName: string, queueNamePrefix: string, provider: string}}
   */
  getConnectionInfo() {
    return {
      accountName: this.settings.accountName,
      queueNamePrefix: this.settings.queueNamePrefix,
      visibilityTimeout: this.settings.visibilityTimeout,
      messageTimeToLive: this.settings.messageTimeToLive,
      provider: 'azure-queue-storage',
      clientsCached: this.queueClients_.size
    };
  }
}

module.exports = QueueingAzure;
