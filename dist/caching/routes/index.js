/**
 * Caching routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.cache - The caching provider.
 */
module.exports = options => {
  if (options['express-app'] && options.cache) {
    const app = options['express-app'];
    const cache = options.cache;
    app.post('/api/caching/put/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      cache.add(key, value).then(() => res.status(200).send('OK')).catch(err => res.status(500).send(err.message));
    });
    app.get('/api/caching/get/:key', (req, res) => {
      const key = req.params.key;
      cache.get(key).then(value => res.status(200).json(value)).catch(err => res.status(500).send(err.message));
    });
    app.delete('/api/caching/delete/:key', (req, res) => {
      const key = req.params.key;
      cache.delete(key).then(() => res.status(200).send('OK')).catch(err => res.status(500).send(err.message));
    });
  }
};