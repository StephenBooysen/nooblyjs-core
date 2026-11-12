/**
 * @fileoverview An Apache ActiveMQ-backed queue implementation providing distributed
 * queue functionality with FIFO (First-In-First-Out) behavior and analytics tracking.
 *
 * Messaging (enqueue/dequeue) is performed over the STOMP protocol (default port 61613)
 * using the `stompit` client. Management operations that STOMP does not expose natively
 * (size, listQueues, purge) are performed against ActiveMQ's Jolokia JMX REST API exposed
 * by the web console (default port 8161).
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

// Lazy load dependencies only when the ActiveMQ provider is instantiated/used.
let stompit;
const axios = require('axios');

/**
 * A class that implements an Apache ActiveMQ-backed queue with FIFO behavior and
 * analytics tracking. Provides a distributed queue using ActiveMQ as the backend with
 * support for multiple named queues.
 *
 * Messages are sent and received over STOMP using persistent delivery and
 * client-individual acknowledgement so a dequeued message is only removed once it has
 * been successfully read. Queue introspection (size/listQueues/purge) uses the Jolokia
 * JMX REST API.
 * @class
 */
class QueueingActiveMQ {
  /**
   * Initializes the ActiveMQ connection settings, Jolokia settings and analytics.
   * @param {Object=} options The connection options for ActiveMQ.
   * @param {string=} options.host The STOMP host (default: 'localhost').
   * @param {number=} options.port The STOMP port (default: 61613).
   * @param {string=} options.stompHost The STOMP virtual host header (default: '/').
   * @param {string=} options.login The broker username (default: 'admin').
   * @param {string=} options.passcode The broker password (default: 'admin').
   * @param {string=} options.destinationPrefix Destination prefix for queues (default: '/queue/').
   * @param {number=} options.dequeueTimeout Milliseconds to wait for a message during dequeue (default: 1000).
   * @param {string=} options.jolokiaUrl The Jolokia base URL (default: 'http://{host}:8161/api/jolokia').
   * @param {string=} options.jolokiaUser The Jolokia/web-console username (default: login).
   * @param {string=} options.jolokiaPassword The Jolokia/web-console password (default: passcode).
   * @param {string=} options.jolokiaOrigin The Origin header sent to satisfy Jolokia CORS checks (default: derived from jolokiaUrl).
   * @param {number=} options.jolokiaTimeout Client-side deadline in ms for each Jolokia call (default: 30000).
   * @param {string=} options.brokerName The ActiveMQ broker name for JMX MBeans (default: 'localhost').
   * @param {string=} options.instanceName The instance name for this queue (default: 'default').
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events.
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'Apache ActiveMQ settings for distributed queue operations (STOMP + Jolokia JMX)';
    this.settings.list = [
      { setting: 'host', type: 'string', values: ['localhost'] },
      { setting: 'port', type: 'number', values: [61613] },
      { setting: 'login', type: 'string', values: ['admin'] },
      { setting: 'passcode', type: 'string', values: ['admin'] },
      { setting: 'destinationPrefix', type: 'string', values: ['/queue/'] },
      { setting: 'dequeueTimeout', type: 'number', values: [1000] },
      { setting: 'jolokiaUrl', type: 'string', values: ['http://localhost:8161/api/jolokia'] },
      { setting: 'jolokiaTimeout', type: 'number', values: [30000] },
      { setting: 'brokerName', type: 'string', values: ['localhost'] }
    ];

    this.settings.host = options?.host || 'localhost';
    this.settings.port = options?.port || 61613;
    this.settings.stompHost = options?.stompHost || '/';
    this.settings.login = options?.login || 'admin';
    this.settings.passcode = options?.passcode || 'admin';
    this.settings.destinationPrefix = options?.destinationPrefix || '/queue/';
    this.settings.dequeueTimeout = options?.dequeueTimeout || 1000;

    this.settings.jolokiaUrl = options?.jolokiaUrl || `http://${this.settings.host}:8161/api/jolokia`;
    this.settings.jolokiaUser = options?.jolokiaUser || this.settings.login;
    this.settings.jolokiaPassword = options?.jolokiaPassword || this.settings.passcode;
    // Jolokia uses strict CORS checking; a localhost Origin satisfies the default allow list.
    this.settings.jolokiaOrigin = options?.jolokiaOrigin || (() => {
      try {
        const u = new URL(this.settings.jolokiaUrl);
        return `${u.protocol}//${u.host}`;
      } catch {
        return 'http://localhost:8161';
      }
    })();
    // Deadline for every Jolokia call (size/listQueues/purge). This is an AXIOS
    // deadline, i.e. a budget for the whole client-side round trip — not a
    // server-side one — so it is spent by anything that delays the request
    // inside this process, not just by a slow broker.
    //
    // It was a hard-coded 10s, which a busy host defeats: the working service
    // polls size() on a timer, and while a heavy job saturates the process a
    // poll can sit unserved past its own deadline and fail with "timeout of
    // 10000ms exceeded" against a broker that answers the identical call in
    // ~13ms. Failing fast buys nothing here — the caller simply retries on the
    // next tick — so the default is generous and tunable rather than tight.
    this.settings.jolokiaTimeout = this.coercePositiveNumber_(options?.jolokiaTimeout, 30000);

    this.settings.brokerName = options?.brokerName || 'localhost';

    /** @private {Object} STOMP client connection. */
    this.client_ = null;

    /** @private {boolean} Connection status. */
    this.connected_ = false;

    /** @private {Promise<Object>|null} In-flight connection promise to avoid races. */
    this.connecting_ = null;

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {!Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
  }

  /**
   * Get all our settings.
   * @return {Promise<Object>} The settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Set all our settings.
   * @param {Object} settings A map of setting names to values.
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting],
          operation: 'saveSettings'
        });
      }
    }
  }

  /**
   * Coerces a configured value to a positive number, falling back when it is
   * absent or unusable. Settings routinely arrive as strings (from .env or a
   * settings UI), and a NaN timeout would make axios fail instantly rather than
   * wait — so the coercion is what keeps a mistyped value from silently
   * becoming the tightest possible deadline.
   * @param {*} value
   * @param {number} fallback
   * @return {number}
   * @private
   */
  coercePositiveNumber_(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * Validates that a queue name is a non-empty string.
   * @param {string} queueName The queue name to validate.
   * @param {string} method The calling method name for error context.
   * @throws {Error} When queue name is invalid.
   * @private
   */
  validateQueueName_(queueName, method) {
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queue name: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method,
          error: error.message,
          queueName
        });
      }
      throw error;
    }
  }

  /**
   * Builds the STOMP destination string for a queue name.
   * @param {string} queueName The queue name.
   * @return {string} The fully-qualified STOMP destination.
   * @private
   */
  destinationFor_(queueName) {
    return `${this.settings.destinationPrefix}${queueName}`;
  }

  /**
   * Adds an item to the specified queue (enqueue operation).
   * @param {string} queueName The name of the queue.
   * @param {*} item The item to add to the queue.
   * @return {Promise<void>} A promise that resolves when the item is enqueued.
   */
  async enqueue(queueName, item) {
    this.validateQueueName_(queueName, 'enqueue');
    const client = await this.ensureConnection_();
    const itemStr = typeof item === 'string' ? item : JSON.stringify(item);

    await new Promise((resolve, reject) => {
      try {
        const frame = client.send({
          'destination': this.destinationFor_(queueName),
          'content-type': 'application/json',
          'persistent': 'true'
        });
        frame.write(itemStr);
        frame.end();
        // The frame is flushed asynchronously; defer resolution to the next tick.
        setImmediate(resolve);
      } catch (err) {
        reject(new Error(`Failed to enqueue item to queue "${queueName}": ${err.message}`));
      }
    });

    this.trackOperation_(queueName);
    if (this.eventEmitter_) {
      this.eventEmitter_.emit(`queue:enqueue:${this.instanceName_}`, { queueName, item });
    }
  }

  /**
   * Removes and returns the item from the front of the specified queue (dequeue operation).
   * Subscribes with client-individual acknowledgement and a prefetch of 1 so exactly one
   * message is removed per call; if no message arrives within the configured timeout the
   * call resolves to undefined.
   * @param {string} queueName The name of the queue.
   * @param {Object=} options Optional options for dequeue behavior.
   * @param {number=} options.timeout Override the configured dequeue timeout in milliseconds.
   * @return {Promise<*>} A promise that resolves to the item from the queue, or undefined if empty.
   */
  async dequeue(queueName, options = {}) {
    this.validateQueueName_(queueName, 'dequeue');
    const client = await this.ensureConnection_();
    const timeout = options.timeout != null ? options.timeout : this.settings.dequeueTimeout;

    const item = await new Promise((resolve, reject) => {
      let settled = false;
      let subscription = null;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (subscription) subscription.unsubscribe();
        resolve(undefined);
      }, timeout);

      try {
        subscription = client.subscribe({
          'destination': this.destinationFor_(queueName),
          'ack': 'client-individual',
          'activemq.prefetchSize': '1'
        }, (err, message) => {
          if (settled) return;
          if (err) {
            settled = true;
            clearTimeout(timer);
            return reject(new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`));
          }
          message.readString('utf-8', (readErr, body) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (readErr) {
              if (subscription) subscription.unsubscribe();
              return reject(new Error(`Failed to read message from queue "${queueName}": ${readErr.message}`));
            }
            // Acknowledge to remove the message, then stop receiving further messages.
            client.ack(message);
            if (subscription) subscription.unsubscribe();
            let parsed = body;
            try {
              parsed = JSON.parse(body);
            } catch {
              parsed = body;
            }
            resolve(parsed);
          });
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`));
      }
    });

    this.trackOperation_(queueName);
    if (this.eventEmitter_) {
      this.eventEmitter_.emit(`queue:dequeue:${this.instanceName_}`, { queueName, item });
    }
    return item;
  }

  /**
   * Returns the number of items in the specified queue using the Jolokia JMX API.
   * @param {string} queueName The name of the queue.
   * @return {Promise<number>} A promise that resolves to the number of items in the queue.
   */
  async size(queueName) {
    this.validateQueueName_(queueName, 'size');
    try {
      const mbean = this.queueMBean_(queueName);
      const value = await this.jolokiaRead_(mbean, 'QueueSize');
      return typeof value === 'number' ? value : 0;
    } catch (err) {
      // A queue that has never been created has no MBean; treat as empty.
      if (this.isMBeanNotFound_(err)) {
        return 0;
      }
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names known to the broker via the Jolokia JMX API.
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names.
   */
  async listQueues() {
    try {
      const brokerMBean = `org.apache.activemq:type=Broker,brokerName=${this.settings.brokerName}`;
      const queues = await this.jolokiaRead_(brokerMBean, 'Queues');
      if (!Array.isArray(queues)) return [];
      return queues
        .map((q) => this.parseDestinationName_(q && q.objectName))
        .filter((name) => !!name);
    } catch (err) {
      throw new Error(`Failed to list queues: ${err.message}`);
    }
  }

  /**
   * Purges all items from the specified queue using the Jolokia JMX API.
   * @param {string} queueName The name of the queue to purge.
   * @return {Promise<void>} A promise that resolves when the queue is purged.
   */
  async purge(queueName) {
    this.validateQueueName_(queueName, 'purge');
    try {
      const mbean = this.queueMBean_(queueName);
      await this.jolokiaExec_(mbean, 'purge');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:purge:${this.instanceName_}`, { queueName });
      }
    } catch (err) {
      if (this.isMBeanNotFound_(err)) {
        return; // Nothing to purge.
      }
      throw new Error(`Failed to purge queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Whether an error from a Jolokia call indicates the target MBean does not
   * exist (e.g. a queue that has not been created yet). Checks the preserved
   * JMX status/error type first, then falls back to message matching.
   * @param {Error} err
   * @return {boolean}
   * @private
   */
  isMBeanNotFound_(err) {
    if (!err) return false;
    if (err.jolokiaStatus === 404) return true;
    const haystack = `${err.jolokiaErrorType || ''} ${err.message || ''}`;
    return /InstanceNotFound|not.*registered|404/i.test(haystack);
  }

  /**
   * Builds the JMX MBean object name for a queue destination.
   * @param {string} queueName The queue name.
   * @return {string} The MBean object name.
   * @private
   */
  queueMBean_(queueName) {
    return `org.apache.activemq:type=Broker,brokerName=${this.settings.brokerName},` +
      `destinationType=Queue,destinationName=${queueName}`;
  }

  /**
   * Extracts the destinationName property from a JMX object name string.
   * @param {string} objectName The JMX object name.
   * @return {?string} The destination name, or null if not present.
   * @private
   */
  parseDestinationName_(objectName) {
    if (!objectName || typeof objectName !== 'string') return null;
    const match = objectName.match(/destinationName=([^,]+)/);
    return match ? match[1] : null;
  }

  /**
   * Performs a Jolokia JMX read request.
   * @param {string} mbean The MBean object name.
   * @param {string} attribute The attribute to read.
   * @return {Promise<*>} The attribute value.
   * @throws {Error} When the Jolokia request fails.
   * @private
   */
  async jolokiaRead_(mbean, attribute) {
    const url = `${this.settings.jolokiaUrl}/read/${encodeURIComponent(mbean)}/${encodeURIComponent(attribute)}`;
    const res = await axios.get(url, this.jolokiaRequestConfig_());
    return this.unwrapJolokia_(res.data);
  }

  /**
   * Performs a Jolokia JMX exec (operation) request.
   * @param {string} mbean The MBean object name.
   * @param {string} operation The operation name.
   * @param {Array=} args The operation arguments.
   * @return {Promise<*>} The operation result.
   * @throws {Error} When the Jolokia request fails.
   * @private
   */
  async jolokiaExec_(mbean, operation, args = []) {
    const body = { type: 'exec', mbean, operation, arguments: args };
    const res = await axios.post(this.settings.jolokiaUrl, body, this.jolokiaRequestConfig_());
    return this.unwrapJolokia_(res.data);
  }

  /**
   * Builds the axios request configuration shared by all Jolokia calls.
   * @return {Object} The axios configuration.
   * @private
   */
  jolokiaRequestConfig_() {
    return {
      timeout: this.settings.jolokiaTimeout,
      auth: { username: this.settings.jolokiaUser, password: this.settings.jolokiaPassword },
      headers: {
        'Origin': this.settings.jolokiaOrigin,
        'Content-Type': 'application/json'
      }
    };
  }

  /**
   * Validates a Jolokia response envelope and returns the value, throwing on JMX errors.
   * @param {Object} data The Jolokia response body.
   * @return {*} The response value.
   * @throws {Error} When the Jolokia response indicates an error.
   * @private
   */
  unwrapJolokia_(data) {
    if (data && data.status && data.status !== 200) {
      // Preserve the JMX status and error type so callers can distinguish a
      // genuinely-absent MBean (e.g. a queue not yet created → 404 /
      // InstanceNotFoundException) from a real failure. The raw `error` is
      // often just the object name, which loses that distinction on its own.
      const detail = data.error_type
        ? `${data.error_type}: ${data.error || ''}`.trim()
        : (data.error || `Jolokia error status ${data.status}`);
      const error = new Error(detail);
      error.jolokiaStatus = data.status;
      error.jolokiaErrorType = data.error_type;
      throw error;
    }
    return data ? data.value : undefined;
  }

  /**
   * Tracks a queue operation for analytics.
   * @param {string} queueName The queue name being accessed.
   * @private
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
        this.removeLeastRecentlyUsed_();
      }

      this.analytics_.set(queueName, entry);
    }
  }

  /**
   * Removes the least recently used entry from analytics.
   * @private
   */
  removeLeastRecentlyUsed_() {
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
   * Gets analytics data for queue operations.
   * @return {Array<{queueName: string, operations: number, lastActivity: string}>} Analytics data.
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
   * Ensures the STOMP connection is established and ready.
   * @return {!Promise<Object>} A promise that resolves to the connected STOMP client.
   * @throws {Error} When the connection cannot be established.
   * @private
   */
  async ensureConnection_() {
    if (this.connected_ && this.client_) {
      return this.client_;
    }
    if (this.connecting_) {
      return this.connecting_;
    }

    this.connecting_ = new Promise((resolve, reject) => {
      try {
        if (!stompit) {
          stompit = requireOptional('stompit', "queue('activemq')");
        }

        const connectOptions = {
          host: this.settings.host,
          port: this.settings.port,
          connectHeaders: {
            host: this.settings.stompHost,
            login: this.settings.login,
            passcode: this.settings.passcode,
            'heart-beat': '5000,5000'
          }
        };

        stompit.connect(connectOptions, (err, client) => {
          if (err) {
            this.connected_ = false;
            this.connecting_ = null;
            return reject(new Error(`Failed to connect to ActiveMQ: ${err.message}`));
          }

          this.client_ = client;
          this.connected_ = true;
          this.connecting_ = null;

          client.on('error', (connErr) => {
            this.connected_ = false;
            this.client_ = null;
            if (this.eventEmitter_) {
              this.eventEmitter_.emit('activemq:error', connErr);
            }
            this.logger?.error(`[${this.constructor.name}] STOMP connection error`, {
              error: connErr.message,
              operation: 'connection'
            });
          });

          if (this.eventEmitter_) {
            this.eventEmitter_.emit('activemq:ready');
          }
          resolve(client);
        });
      } catch (err) {
        this.connected_ = false;
        this.connecting_ = null;
        reject(new Error(`Failed to connect to ActiveMQ: ${err.message}`));
      }
    });

    return this.connecting_;
  }

  /**
   * Gracefully closes the STOMP connection and cleans up resources.
   * @return {!Promise<void>}
   */
  async disconnect() {
    return new Promise((resolve) => {
      if (!this.client_) {
        this.connected_ = false;
        return resolve();
      }
      try {
        this.client_.disconnect((err) => {
          if (err) {
            this.logger?.error(`[${this.constructor.name}] Error disconnecting from ActiveMQ`, {
              error: err.message,
              operation: 'disconnect'
            });
          }
          this.connected_ = false;
          this.client_ = null;
          resolve();
        });
      } catch (err) {
        this.logger?.error(`[${this.constructor.name}] Error disconnecting from ActiveMQ`, {
          error: err.message,
          operation: 'disconnect'
        });
        this.connected_ = false;
        this.client_ = null;
        resolve();
      }
    });
  }

  /**
   * Gets connection status information.
   * @return {{status: string, connected: boolean, url: string, jolokiaUrl: string}}
   */
  getConnectionInfo() {
    return {
      status: this.connected_ ? 'connected' : 'disconnected',
      connected: this.connected_,
      url: `stomp://${this.settings.host}:${this.settings.port}`,
      jolokiaUrl: this.settings.jolokiaUrl
    };
  }
}

module.exports = QueueingActiveMQ;
