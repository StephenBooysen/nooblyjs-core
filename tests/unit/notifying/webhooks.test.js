'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const createQueue = require('../../../src/queueing');
const createSettings = require('../../../src/settings');
const { WebhookDispatcher, WEBHOOK_QUEUE } = require('../../../src/notifying/modules/webhooks');
const { verifyPayload } = require('../../../src/shared/utils/webhookSignature');
const { testDataDir } = require('../../helpers/testData');

/** A public address literal, so the SSRF guard needs no DNS lookup. */
const PUBLIC_URL = 'https://93.184.216.34/hooks';

/** Waits until a condition holds, polling the dispatcher's log. */
async function until(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return condition();
}

describe('outbound webhooks (feature 12)', () => {
  let dir;
  let emitter;
  let queue;
  let settings;
  let dispatcher;

  const response = (status) => ({ ok: status >= 200 && status < 300, status });

  const build = (options = {}) => {
    dispatcher = new WebhookDispatcher({
      queue,
      settings,
      eventEmitter: emitter,
      attempts: 1,
      backoff: { type: 'fixed', baseMs: 5, maxMs: 5 },
      timeoutMs: 2000,
      ...options
    });
    return dispatcher;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('webhooks'), 'nooblyjs-webhooks-'));
    emitter = new EventEmitter();
    queue = createQueue('memory', { dependencies: {} }, emitter);
    settings = createSettings('file', {
      filepath: path.join(dir, 'settings.enc.json'),
      secret: 'webhook-test-secret',
      refreshMs: 0
    }, emitter);
  });

  afterEach(async () => {
    if (dispatcher) await dispatcher.stop();
    dispatcher = null;
    emitter.removeAllListeners();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('subscriptions', () => {
    it('creates a subscription, returns its generated secret once, and masks it afterwards', async () => {
      build();
      const created = await dispatcher.subscribe({ url: PUBLIC_URL, events: ['order.created'] });
      expect(created.secret).toMatch(/^whsec_/);

      const [listed] = await dispatcher.list();
      expect(listed).toMatchObject({ id: created.id, url: PUBLIC_URL, active: true, failures: 0 });
      expect(listed.secret).not.toContain(created.secret.slice(10, 20));
      expect(listed.secret.endsWith(created.secret.slice(-4))).toBe(true);
    });

    it('refuses plain http, unknown shapes and bad event names', async () => {
      build();
      await expect(dispatcher.subscribe({ url: 'http://93.184.216.34/x', events: ['a'] })).rejects.toThrow(/https/);
      await expect(dispatcher.subscribe({ url: PUBLIC_URL, events: [] })).rejects.toThrow(/events/);
      await expect(dispatcher.subscribe({ url: PUBLIC_URL, events: ['bad name!'] })).rejects.toThrow(/Invalid event name/);
      await expect(dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'], secret: 'short' })).rejects.toThrow(/16/);
    });

    it('refuses a private address through the SSRF guard', async () => {
      build();
      await expect(dispatcher.subscribe({ url: 'https://127.0.0.1/hook', events: ['a'] })).rejects.toThrow(/private/);
      await expect(dispatcher.subscribe({ url: 'https://10.0.0.5/hook', events: ['a'] })).rejects.toThrow(/private/);
    });

    it('deletes a subscription', async () => {
      build();
      const { id } = await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      expect(await dispatcher.unsubscribe(id)).toBe(true);
      expect(await dispatcher.list()).toEqual([]);
    });
  });

  describe('delivery', () => {
    it('sends a signed request that the receiver can verify, and logs it as delivered', async () => {
      const fetch = jest.fn(async () => response(200));
      build({ fetch });
      const { secret } = await dispatcher.subscribe({ url: PUBLIC_URL, events: ['order.created'] });
      const { queued } = await dispatcher.publish('order.created', { orderId: 'o-1' });
      expect(queued).toBe(1);

      expect(await until(() => dispatcher.deliveries().some((d) => d.status === 'delivered'))).toBe(true);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(PUBLIC_URL);
      expect(init.redirect).toBe('error');
      expect(init.headers['NooblyJS-Event']).toBe('order.created');
      expect(verifyPayload(init.headers['NooblyJS-Signature'], init.body, secret).ok).toBe(true);
      expect(JSON.parse(init.body)).toMatchObject({ type: 'order.created', data: { orderId: 'o-1' } });
    });

    it('only delivers to subscriptions listening for the event, or for all events', async () => {
      const fetch = jest.fn(async () => response(200));
      build({ fetch });
      await dispatcher.subscribe({ url: PUBLIC_URL, events: ['order.paid'] });
      await dispatcher.subscribe({ url: 'https://93.184.216.35/all', events: ['*'] });
      const { queued } = await dispatcher.publish('order.created', {});
      expect(queued).toBe(1);
      expect(await until(() => fetch.mock.calls.length === 1)).toBe(true);
      expect(fetch.mock.calls[0][0]).toBe('https://93.184.216.35/all');
    });

    it('retries a failing endpoint with backoff, and then succeeds', async () => {
      const statuses = [500, 503, 200];
      const fetch = jest.fn(async () => response(statuses.shift()));
      build({ fetch, attempts: 3 });
      await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      await dispatcher.publish('a', {});

      expect(await until(() => dispatcher.deliveries().some((d) => d.status === 'delivered'))).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
      const statusesLogged = dispatcher.deliveries().map((d) => d.status).reverse();
      expect(statusesLogged).toEqual(['failed', 'failed', 'delivered']);
    });

    it('moves a delivery to the dead-letter list after the configured attempts', async () => {
      const fetch = jest.fn(async () => response(500));
      build({ fetch, attempts: 2, disableAfterFailures: 100 });
      await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      await dispatcher.publish('a', {});

      expect(await until(async () => (await queue.jobCounts(WEBHOOK_QUEUE)).dead === 1)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(dispatcher.deliveries()[0].status).toBe('dead');
    });

    it('disables a subscription after repeated failures', async () => {
      const fetch = jest.fn(async () => response(500));
      const disabled = jest.fn();
      emitter.on('webhooks:disabled', disabled);
      build({ fetch, attempts: 1, disableAfterFailures: 2 });
      const { id } = await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });

      await dispatcher.publish('a', {});
      await dispatcher.publish('a', {});
      expect(await until(() => disabled.mock.calls.length === 1)).toBe(true);
      const [sub] = await dispatcher.list();
      expect(sub).toMatchObject({ id, active: false, failures: 2 });
    });

    it('skips a queued delivery whose subscription was removed before it ran', async () => {
      const fetch = jest.fn(async () => response(200));
      build({ fetch });
      const { id } = await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      await dispatcher.unsubscribe(id);
      await queue.enqueue(WEBHOOK_QUEUE, {
        deliveryId: 'del-x', subscriptionId: id, event: 'a', body: '{}'
      }, {});
      await dispatcher.publish('nothing', {});
      expect(await until(() => dispatcher.deliveries().some((d) => d.status === 'skipped'))).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('redelivers an earlier delivery under a new id, with the same body', async () => {
      const fetch = jest.fn(async () => response(200));
      build({ fetch });
      await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      await dispatcher.publish('a', { n: 1 });
      expect(await until(() => dispatcher.deliveries().length === 1)).toBe(true);
      const original = dispatcher.deliveries()[0];

      const { deliveryId } = await dispatcher.redeliver(original.deliveryId);
      expect(deliveryId).not.toBe(original.deliveryId);
      expect(await until(() => fetch.mock.calls.length === 2)).toBe(true);
      expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
      await expect(dispatcher.redeliver('del-unknown')).rejects.toThrow(/not found/);
    });

    it('keeps the delivery log bounded and free of response bodies', async () => {
      const fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'secret echo' }));
      build({ fetch });
      await dispatcher.subscribe({ url: PUBLIC_URL, events: ['a'] });
      await dispatcher.publish('a', {});
      expect(await until(() => dispatcher.deliveries().length === 1)).toBe(true);
      expect(JSON.stringify(dispatcher.deliveries())).not.toContain('secret echo');
      expect(Object.keys(dispatcher.deliveries()[0])).not.toContain('body');
    });
  });
});
