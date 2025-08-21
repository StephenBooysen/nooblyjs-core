/**
 * Logging routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.logger - The logging provider.
 */
module.exports = (options, eventEmitter, logger) => {

  if (options['express-app'] && logger) {
    const app = options['express-app'];

    app.post('/services/logging/api/log', (req, res) => {
      const message = req.body;
      if (message) {
        logger
          .log(message)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing message');
      }
    });

    app.get('/services/logging/api/status', (req, res) => {
      eventEmitter.emit('api-logging-status', 'logging api running');
      res.status(200).json('logging api running');
    });
  }
};
