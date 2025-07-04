/**
 * Measuring routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.measuring - The measuring provider.
 */
module.exports = (options, eventEmitter, measuring) => {

  if (options['express-app'] && measuring) {
    const app = options['express-app'];

    app.post('/api/measuring/measure', (req, res) => {
      const { metric, value } = req.body;
      if (metric && value) {
        measuring
          .measure(metric, value)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing metric or value');
      }
    });

    app.get('/api/measuring/status', (req, res) => {
      eventEmitter.emit('api-measuring-status', 'measuring api running');
      res.status(200).json('measuring api running');
    });
  }
};
