
/**
 * Logging routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} eventEmitter - The event emitter.
 * @param {object} log - The logging provider.
 */
module.exports = (options,eventEmitter, log) => {
  eventEmitter.emit('instance', { options: options });

  if (options['express-app'] && log) {
    const app = options['express-app'];

    app.post('/api/logging/log', (req, res) => {
      const value = req.body;
      log.log(value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/logging/status', (req, res) => {
      eventEmitter.emit("api-cache-status","caching api running");
      res.status(200).json("running");
    });
  }
};
