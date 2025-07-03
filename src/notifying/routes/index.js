
/**
 * Notifying routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.notifier - The notifying provider.
 */
module.exports = (options, eventEmitter, notifier) => {
  eventEmitter.emit('instance', { options: options });
  if (options['express-app'] && notifier) {
    const app = options['express-app'];

    app.post('/api/notifying/send', (req, res) => {
      const { recipient, message } = req.body;
      if (recipient && message) {
        notifier.send(recipient, message)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing recipient or message');
      }
    });

    app.get('/api/notifying/status', (req, res) => {
      eventEmitter.emit("api-notifying-status","notifying api running");
      res.status(200).json("running");
    });
  }
};
