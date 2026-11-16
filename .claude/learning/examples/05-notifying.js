'use strict';
// Example 05: the notifying service: in-process topics and outbound webhooks.
const { registry, call, done, dataDir } = require('./setup');
const path = require('node:path');

(async () => {
  // Notifying depends on queueing and settings. Create those first if you
  // want them to share instances with the rest of your app.
  registry.queue('memory');
  registry.settings('file', { filepath: path.join(dataDir, 'settings-05.json'), secret: 'learning-secret-0123456789abcdef' });
  const notifying = registry.notifying('default');

  // Topics: publish a message, and every subscriber callback receives it.
  await notifying.createTopic('orders');
  notifying.subscribe('orders', (message) => console.log('subscriber got:', message));
  await notifying.notify('orders', 'order ord-1001 created');
  console.log('history length', notifying.getNotifications().length);

  // Webhooks: other systems subscribe to events. Each delivery is signed with
  // a per-subscription secret, sent on the reliable queue, and retried.
  // Private and loopback addresses are refused, so a webhook cannot reach
  // your own network by accident.
  try {
    await notifying.subscribeWebhook({ url: 'https://127.0.0.1:8443/hook', events: ['order.created'] });
  } catch (err) {
    console.log('private webhook refused:', err.message);
  }

  // Over REST: publish to a topic and read the webhook list.
  const sent = await call('POST', '/services/notifying/api/notify/topic/orders', { message: 'via REST' });
  console.log('rest notify', sent.status);
  const hooks = await call('GET', '/services/notifying/api/webhooks');
  console.log('rest webhooks', hooks.status, hooks.body);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
