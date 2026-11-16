# 05: Notifying and webhooks

**Time:** about 20 minutes · **Example:** [`examples/05-notifying.js`](examples/05-notifying.js) · **Run:** `node .claude/learning/examples/05-notifying.js`

## What you will learn

Send messages to topics inside your app, and send signed webhooks to other systems, and verify those signatures on the receiving side.

## Key ideas

- **Topics are for inside the app.** A topic has subscribers, and each `notify` calls every subscriber callback in the same process.
- **Webhooks are for other systems.** A subscription is a URL, the events it wants, and a secret. Each delivery is an HTTP POST, signed with that secret, sent through the queue, and retried on failure.
- **Signatures prove the sender.** Each request carries a `NooblyJS-Signature` header: a timestamp and an HMAC-SHA256 over the timestamp and the raw body. The receiver recomputes it with the shared secret and rejects anything that does not match or is too old.
- **Private addresses are refused.** Webhook URLs must use `https`, and must not resolve to a private or loopback address. This stops a subscription from reaching services on your own network.
- **Dependencies.** Webhooks need the queueing and settings services. The registry creates them for you.

## Walk-through

### Topics

```javascript
const notifying = registry.notifying('default');

await notifying.createTopic('orders');
notifying.subscribe('orders', (message) => console.log('subscriber got:', message));
await notifying.notify('orders', 'order ord-1001 created');
```

The subscriber receives the message. `getNotifications()` returns the recent history.

### A webhook subscription

```javascript
await notifying.subscribeWebhook({
  url: 'https://partner.example.com/hooks/orders',
  events: ['order.created'],
  description: 'Partner order feed',
});
```

If you do not pass a `secret`, one is generated and returned with the subscription. Store it on the receiving side. The example tries a loopback address, which is refused:

```
Blocked request: host "127.0.0.1" resolves to a private/reserved address
```

### Verifying a delivery on the receiver

The receiver needs the raw request body and the secret. This is the check it runs:

```javascript
const { verifyPayload, SIGNATURE_HEADER } = require('nooblyjs-core/src/shared/utils/webhookSignature');

app.post('/hooks/orders', express.raw({ type: '*/*' }), (req, res) => {
  const result = verifyPayload(req.get(SIGNATURE_HEADER), req.body, process.env.ORDERS_HOOK_SECRET);
  if (!result.ok) return res.status(401).send(result.reason);
  // Handle the event. Respond with 2xx quickly; do slow work later.
  res.sendStatus(204);
});
```

Verification checks the signature and rejects a timestamp outside a five-minute window (`toleranceSec` changes it). Compare against the raw bytes: if a framework parses the JSON first and re-serialises it, the signature no longer matches.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/notifying/api/topic` | Create a topic |
| POST | `/services/notifying/api/subscribe/topic/:topic` | Subscribe to a topic |
| POST | `/services/notifying/api/notify/topic/:topic` | Publish to a topic |
| GET | `/services/notifying/api/notifications` | Recent notifications |
| GET | `/services/notifying/api/webhooks` | List webhook subscriptions |
| POST | `/services/notifying/api/webhooks` | Create a subscription |
| DELETE | `/services/notifying/api/webhooks/:id` | Remove a subscription |
| POST | `/services/notifying/api/webhooks/publish` | Publish an event to matching subscriptions |
| GET | `/services/notifying/api/webhooks/deliveries` | Delivery history |
| POST | `/services/notifying/api/webhooks/deliveries/:deliveryId/redeliver` | Send a delivery again |

## Providers

| Type | Use it for |
|---|---|
| `default` | In-process topics, and webhooks with the queue and settings services |
| `api` | Proxies to a remote notifying service |

## Common mistakes

- **Parsing the body before verifying.** Verify the raw bytes, or the signature will not match.
- **Doing slow work before responding.** Deliveries time out. Acknowledge with a 2xx, then process the event.
- **Treating topic subscribers as durable.** Topic callbacks run in the process that publishes. A subscriber that is not running misses the message. Use a webhook or a queue for work that must not be lost.
- **Sharing one secret across subscriptions.** Give each receiver its own, so one leak does not expose the others.
- **Ignoring a private-address refusal.** It is a safety check. To reach an internal service on purpose, allow it through the webhook options, and only for hosts you control.

## Try it

1. Subscribe a second callback to `orders` and check that both receive the next message.
2. Build the verification snippet into a small Express app and sign a body with `signPayload(secret, body)`. Check that a changed body fails.
3. Look at the delivery history (`GET /services/notifying/api/webhooks/deliveries`) after a publish, and find the status of each delivery.
