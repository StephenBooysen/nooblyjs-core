'use strict';
// Example 01: the logging service.
const { registry, call, done } = require('./setup');

(async () => {
  // Create the logger. 'memory' keeps entries in the process; 'file' writes
  // them to the log folder. Creating the service mounts its REST routes.
  const logger = registry.logger('memory');

  // Structured messages: a text message plus an object of details.
  logger.info('Order received', { orderId: 'ord-1001', amount: 49.99 });
  logger.warn('Payment slow', { orderId: 'ord-1001', seconds: 12 });
  logger.error('Payment failed', { orderId: 'ord-1002', code: 'CARD_DECLINED' });

  // Read the most recent entries over REST.
  const logs = await call('GET', '/services/logging/api/logs');
  console.log('status', logs.status, 'entries', logs.body.count);
  console.log('newest', logs.body.logs[logs.body.logs.length - 1]?.message);

  // Write one more entry through REST.
  const written = await call('POST', '/services/logging/api/info', {
    message: 'Written over REST',
    meta: { source: 'example' },
  });
  console.log('rest write', written.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
