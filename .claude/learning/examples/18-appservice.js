'use strict';
// Example 18: the appservice service: the base classes for your own application code.
const { registry, app, eventEmitter, call, done } = require('./setup');

(async () => {
  // appservice gives you base classes for routes, services, data, views and
  // activities. The factory also scans a standard folder layout when you give
  // it a root folder: src/routes, src/services, src/data, src/views, src/activities.
  const kit = registry.appservice('default', {
    name: 'Orders',
    baseUrl: '/orders',
    'express-app': app,
    dependencies: { logging: registry.logger('memory'), cache: registry.cache('memory') },
  }, eventEmitter);
  console.log('base classes', Object.keys(kit).join(', '));

  // A dependency your routes need: the cache service.
  const cache = registry.cache('memory');

  // A route class: extend appRouteBase, register routes in its constructor.
  class OrderRoutes extends kit.appRouteBase {
    constructor(type, options, emitter) {
      super(type, options, emitter);
      this.setupRoutes();
    }

    setupRoutes() {
      // this.app is the Express app; this.baseUrl ends with '/'.
      this.app.get(this.baseUrl + 'status', (req, res) => res.json({ ok: true, app: 'Orders' }));
      this.app.get(this.baseUrl + ':id', async (req, res) => {
        const cached = await cache.get(`order:${req.params.id}`);
        res.json(cached ?? { id: req.params.id, status: 'not cached' });
      });
    }
  }

  // Instantiate it. It registers its routes on the shared Express app.
  new OrderRoutes('orders-routes', {
    'express-app': app,
    baseUrl: '/orders',
  }, eventEmitter);

  await cache.put('order:ord-1001', { id: 'ord-1001', status: 'shipped' });

  console.log('status route', (await call('GET', '/orders/status')).body);
  console.log('order route', (await call('GET', '/orders/ord-1001')).body);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
