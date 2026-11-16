'use strict';

/**
 * @fileoverview Outbound webhooks for the notifying service (feature 12).
 *
 * Subscriptions are stored in the settings group `webhooks`, so their secrets
 * are encrypted at rest. Each delivery is a job on the reliable queue, so a
 * failed delivery is retried with backoff and then kept as a dead letter.
 * Each request is signed with NooblyJS-Signature (see webhookSignature.js).
 * Every URL passes the SSRF guard from the fetching service, on every attempt.
 *
 * @module notifying/modules/webhooks
 */

const crypto = require('node:crypto');
const { continueTrace } = require('../../telemetry/propagation');
const { ClientError } = require('../../shared/utils/httpErrors');
const { assertUrlAllowed } = require('../../fetching/modules/ssrfGuard');
const { signPayload, SIGNATURE_HEADER } = require('../../shared/utils/webhookSignature');

/** Settings group that holds the subscriptions. */
const WEBHOOK_GROUP = 'webhooks';

/** Queue that holds deliveries. Queue names follow the nooblyjs-core-* convention. */
const WEBHOOK_QUEUE = 'nooblyjs-core-webhooks';

/** Event names: letters, digits, dots, dashes and underscores. */
const EVENT_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Deliveries kept in the in-memory log. */
const LOG_LIMIT = 500;

const DEFAULTS = Object.freeze({
  attempts: 6,
  backoff: Object.freeze({ type: 'exponential', baseMs: 2000, maxMs: 300000 }),
  timeoutMs: 10000,
  disableAfterFailures: 10,
  maxEventsPerSubscription: 20
});

/**
 * Validates and normalises a subscription request.
 *
 * @param {Object} input
 * @param {{allowHttp?: boolean, allowPrivateNetworks?: boolean}} policy
 * @return {{url: string, events: string[], secret: ?string, description: string}}
 * @throws {ClientError} When the request is invalid
 */
function normalizeSubscription(input, policy) {
  if (!input || typeof input !== 'object') throw new ClientError(400, 'A webhook subscription needs a url and events');
  let parsed;
  try {
    parsed = new URL(String(input.url));
  } catch (_error) {
    throw new ClientError(400, 'Invalid webhook url');
  }
  if (parsed.protocol !== 'https:' && !(policy.allowHttp && parsed.protocol === 'http:')) {
    throw new ClientError(400, 'Webhook urls must use https');
  }
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > DEFAULTS.maxEventsPerSubscription) {
    throw new ClientError(400, `events must be a list of 1 to ${DEFAULTS.maxEventsPerSubscription} event names`);
  }
  for (const name of input.events) {
    if (name !== '*' && (typeof name !== 'string' || !EVENT_PATTERN.test(name))) {
      throw new ClientError(400, `Invalid event name "${String(name)}"`);
    }
  }
  if (input.secret !== undefined && (typeof input.secret !== 'string' || input.secret.length < 16)) {
    throw new ClientError(400, 'secret must be a string of at least 16 characters');
  }
  return {
    url: parsed.toString(),
    events: [...new Set(input.events)],
    secret: input.secret === undefined ? null : input.secret,
    description: typeof input.description === 'string' ? input.description.slice(0, 200) : ''
  };
}

/**
 * Masks a secret for display: the last four characters only.
 *
 * @param {string} secret
 * @return {string}
 */
function maskSecret(secret) {
  return `whsec_…${String(secret).slice(-4)}`;
}

/**
 * Sends and tracks webhook deliveries.
 */
class WebhookDispatcher {
  /**
   * @param {Object} options
   * @param {Object} options.queue Queue service with enqueue and process (reliable jobs)
   * @param {Object} options.settings Settings service, used for the `webhooks` group
   * @param {Object=} options.logger Logging service
   * @param {Object=} options.eventEmitter Shared emitter for webhooks:* events
   * @param {function=} options.fetch Fetch implementation (default: global fetch)
   * @param {boolean=} options.allowHttp Accept http:// urls (default false)
   * @param {boolean=} options.allowPrivateNetworks Allow private addresses (default false)
   * @param {number=} options.attempts Attempts per delivery (default 6)
   * @param {Object=} options.backoff Backoff, as for queue jobs
   * @param {number=} options.timeoutMs Per request timeout (default 10 s)
   * @param {number=} options.disableAfterFailures Consecutive failures before a subscription is disabled (default 10)
   */
  constructor(options) {
    this.queue_ = options.queue;
    this.settings_ = options.settings;
    this.logger_ = options.logger || null;
    this.eventEmitter_ = options.eventEmitter || null;
    this.fetch_ = options.fetch || globalThis.fetch;
    this.policy_ = {
      allowHttp: options.allowHttp === true,
      allowPrivateNetworks: options.allowPrivateNetworks === true
    };
    this.attempts_ = options.attempts === undefined ? DEFAULTS.attempts : options.attempts;
    this.backoff_ = { ...DEFAULTS.backoff, ...(options.backoff || {}) };
    this.timeoutMs_ = options.timeoutMs === undefined ? DEFAULTS.timeoutMs : options.timeoutMs;
    this.disableAfter_ = options.disableAfterFailures === undefined ? DEFAULTS.disableAfterFailures : options.disableAfterFailures;
    this.log_ = [];
    this.consumer_ = null;
    // Serialises subscription updates made by deliveries, so two failures
    // cannot both read the same count and write back the same value.
    this.updates_ = Promise.resolve();
  }

  /**
   * Starts the delivery consumer once. The first subscription or publish calls it.
   *
   * @return {void}
   * @private
   */
  ensureConsumer_() {
    if (this.consumer_) return;
    this.consumer_ = this.queue_.process(WEBHOOK_QUEUE, (job) => this.deliver_(job), {
      concurrency: 4,
      pollIntervalMs: 250
    });
  }

  /**
   * Creates a subscription. Generates a secret when none is given; the
   * generated secret is returned once, here, and never again.
   *
   * @param {{url: string, events: string[], secret?: string, description?: string}} input
   * @return {Promise<{id: string, url: string, events: string[], secret: string, active: boolean}>}
   */
  async subscribe(input) {
    const normalized = normalizeSubscription(input, this.policy_);
    await assertUrlAllowed(normalized.url, { allowPrivateNetworks: this.policy_.allowPrivateNetworks });
    const id = `wh_${crypto.randomUUID()}`;
    const secret = normalized.secret || `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const record = {
      url: normalized.url,
      events: normalized.events,
      secret,
      description: normalized.description,
      active: true,
      failures: 0,
      createdAt: new Date().toISOString()
    };
    await this.settings_.set(id, record, WEBHOOK_GROUP);
    this.ensureConsumer_();
    this.eventEmitter_?.emit?.('webhooks:subscribed', { id, url: normalized.url, events: normalized.events });
    return { id, url: record.url, events: record.events, secret, active: true };
  }

  /**
   * Lists subscriptions. Secrets are masked.
   *
   * @return {Promise<Array<Object>>}
   */
  async list() {
    const group = await this.settings_.getGroup(WEBHOOK_GROUP).catch(() => ({}));
    return Object.entries(group).map(([id, sub]) => ({
      id,
      url: sub.url,
      events: sub.events,
      description: sub.description,
      active: sub.active,
      failures: sub.failures,
      createdAt: sub.createdAt,
      secret: maskSecret(sub.secret)
    }));
  }

  /**
   * Deletes a subscription. Deliveries already queued for it are dropped when
   * they run, because the subscription no longer exists.
   *
   * @param {string} id Subscription id
   * @return {Promise<boolean>}
   */
  async unsubscribe(id) {
    return Boolean(await this.settings_.delete(id, WEBHOOK_GROUP).catch(() => false));
  }

  /**
   * Queues a delivery to every active subscription listening for the event.
   *
   * @param {string} event Event name, for example `order.created`
   * @param {*} payload JSON-serialisable data
   * @return {Promise<{queued: number, eventId: string}>}
   */
  async publish(event, payload) {
    if (typeof event !== 'string' || !EVENT_PATTERN.test(event)) throw new ClientError(400, 'Invalid event name');
    const eventId = `evt_${crypto.randomUUID()}`;
    const created = new Date().toISOString();
    const group = await this.settings_.getGroup(WEBHOOK_GROUP).catch(() => ({}));
    let queued = 0;
    for (const [id, sub] of Object.entries(group)) {
      if (!sub.active || !(sub.events.includes('*') || sub.events.includes(event))) continue;
      const deliveryId = `del_${crypto.randomUUID()}`;
      const body = JSON.stringify({ id: eventId, type: event, created, subscription: id, data: payload === undefined ? null : payload });
      await this.queue_.enqueue(WEBHOOK_QUEUE, {
        deliveryId,
        subscriptionId: id,
        event,
        body
      }, {
        attempts: this.attempts_,
        backoff: this.backoff_,
        idempotencyKey: deliveryId
      });
      queued += 1;
    }
    if (queued > 0) this.ensureConsumer_();
    return { queued, eventId };
  }

  /**
   * Queues another delivery of an earlier event, under a new delivery id.
   *
   * @param {string} deliveryId Delivery to send again
   * @return {Promise<{deliveryId: string}>}
   */
  async redeliver(deliveryId) {
    const original = [...this.log_].reverse().find((entry) => entry.deliveryId === deliveryId);
    if (!original) throw new ClientError(404, 'Delivery not found');
    const next = `del_${crypto.randomUUID()}`;
    await this.queue_.enqueue(WEBHOOK_QUEUE, {
      deliveryId: next,
      subscriptionId: original.subscriptionId,
      event: original.event,
      body: original.body
    }, { attempts: this.attempts_, backoff: this.backoff_, idempotencyKey: next });
    this.ensureConsumer_();
    return { deliveryId: next };
  }

  /**
   * Recent deliveries, newest first. Response bodies are not kept: only the
   * status code and an error name.
   *
   * @param {number=} limit Most entries to return (default 50)
   * @return {Array<Object>}
   */
  deliveries(limit = 50) {
    return this.log_.slice(-limit).reverse().map(({ body, ...entry }) => entry);
  }

  /**
   * Runs one delivery attempt. Throws to retry, returns to finish.
   *
   * @param {Object} job Queue job with data, attempts and maxAttempts
   * @return {Promise<void>}
   * @private
   */
  async deliver_(job) {
    // The span is a child of the request that published the event (feature 07).
    return continueTrace(job.data, 'webhook deliver', () => this.deliverOnce_(job));
  }

  /**
   * One delivery attempt, without the trace wrapper.
   *
   * @param {Object} job Queue job
   * @return {Promise<void>}
   * @private
   */
  async deliverOnce_(job) {
    const { deliveryId, subscriptionId, event, body } = job.data;
    const subs = await this.settings_.getGroup(WEBHOOK_GROUP).catch(() => ({}));
    const sub = subs[subscriptionId];
    if (!sub || !sub.active) {
      this.remember_({ deliveryId, subscriptionId, event, body, status: 'skipped', attempt: job.attempts, code: null, error: sub ? 'inactive' : 'unsubscribed', at: new Date().toISOString() });
      return;
    }

    const finalAttempt = job.attempts >= job.maxAttempts;
    let status;
    let code = null;
    let error = null;
    try {
      await assertUrlAllowed(sub.url, { allowPrivateNetworks: this.policy_.allowPrivateNetworks });
      const response = await this.fetch_(sub.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs_),
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signPayload(sub.secret, body),
          'NooblyJS-Event': event,
          'NooblyJS-Delivery': deliveryId
        },
        body
      });
      code = response.status;
      if (response.ok) {
        status = 'delivered';
      } else {
        status = finalAttempt ? 'dead' : 'failed';
        error = `HTTP ${code}`;
      }
    } catch (err) {
      code = null;
      status = finalAttempt ? 'dead' : 'failed';
      // Name only: messages can echo the URL or response data.
      error = err && err.name ? err.name : 'Error';
    }

    this.remember_({ deliveryId, subscriptionId, event, body, status, attempt: job.attempts, code, error, at: new Date().toISOString() });

    if (status === 'delivered') {
      await this.updateSubscription_(subscriptionId, (current) => (current.failures ? { ...current, failures: 0 } : current));
      return;
    }

    // Count consecutive failures; disable the subscription once it is clearly broken.
    let disabledNow = null;
    await this.updateSubscription_(subscriptionId, (current) => {
      const failures = (current.failures || 0) + 1;
      const disable = current.active && failures >= this.disableAfter_;
      if (disable) disabledNow = failures;
      return { ...current, failures, active: disable ? false : current.active };
    });
    if (disabledNow !== null) {
      this.eventEmitter_?.emit?.('webhooks:disabled', { id: subscriptionId, failures: disabledNow });
      this.logger_?.warn?.('[WEBHOOKS] Subscription disabled after repeated failures', { subscriptionId, failures: disabledNow });
    }
    // Throwing hands the job back to the queue: a retry for 'failed', and a
    // dead letter for 'dead', which retryDeadLetters() can requeue later.
    throw new Error(`webhook delivery ${error}`);
  }

  /**
   * Updates one subscription under the dispatcher's lock. The mutate function
   * gets the current stored value, so no update is lost.
   *
   * @param {string} subscriptionId
   * @param {function(Object): Object} mutate Returns the new value (the same object when nothing changes)
   * @return {Promise<?Object>} The stored value, or null when the subscription is gone
   * @private
   */
  updateSubscription_(subscriptionId, mutate) {
    const run = this.updates_.then(async () => {
      const group = await this.settings_.getGroup(WEBHOOK_GROUP).catch(() => ({}));
      const current = group[subscriptionId];
      if (!current) return null;
      const next = mutate(current);
      if (next !== current) await this.settings_.set(subscriptionId, next, WEBHOOK_GROUP);
      return next;
    });
    this.updates_ = run.catch(() => {});
    return run;
  }

  /**
   * Keeps an attempt in the bounded log. The body is kept so the delivery can
   * be sent again.
   *
   * @param {Object} entry
   * @return {void}
   * @private
   */
  remember_(entry) {
    this.log_.push(entry);
    if (this.log_.length > LOG_LIMIT) this.log_.splice(0, this.log_.length - LOG_LIMIT);
    this.eventEmitter_?.emit?.('webhooks:delivery', { deliveryId: entry.deliveryId, status: entry.status });
  }

  /**
   * Stops the consumer. Called by the registry on shutdown and reset.
   *
   * @return {Promise<void>}
   */
  async stop() {
    if (this.consumer_) {
      await this.consumer_.stop();
      this.consumer_ = null;
    }
  }
}

module.exports = { WebhookDispatcher, WEBHOOK_GROUP, WEBHOOK_QUEUE, normalizeSubscription, maskSecret, DEFAULTS };
