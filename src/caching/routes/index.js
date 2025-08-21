/**
 * Caching routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.cache - The caching provider.
 */
module.exports = (options, eventEmitter, cache) => {

  if (options['express-app'] && cache) {
    const app = options['express-app'];

    app.post('/services/caching/api/put/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      cache
        .put(key, value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/services/caching/api/get/:key', (req, res) => {
      const key = req.params.key;
      cache
        .get(key)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.delete('/services/caching/api/delete/:key', (req, res) => {
      const key = req.params.key;
      cache
        .delete(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/services/caching/api/status', (req, res) => {
      eventEmitter.emit('api-cache-status', 'caching api running');
      res.status(200).json('caching api running');
    });

    app.get('/services/caching/api/list', (req, res) => {
      try {
        const analytics = cache.getAnalytics ? cache.getAnalytics() : [];
        eventEmitter.emit('api-cache-list', `retrieved ${analytics.length} analytics entries`);
        res.status(200).json({
          success: true,
          data: analytics,
          total: analytics.length
        });
      } catch (err) {
        eventEmitter.emit('api-cache-list-error', err.message);
        res.status(500).json({
          success: false,
          error: err.message
        });
      }
    });
  }
};
