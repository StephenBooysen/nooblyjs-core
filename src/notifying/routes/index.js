/**
 * Notifying routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.notifier - The notifying provider.
 */
module.exports = (options, eventEmitter, notifier) => {

  if (options['express-app'] && notifier) {
    const app = options['express-app'];

    app.post('/api/notifying/topic', (req, res) => {
      const { topic } = req.body;
      if (topic) {
        notifier
          .createTopic(topic)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic');
      }
    });

    app.post('/api/notifying/subscribe/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const { callbackUrl } = req.body;
      if (topic && callbackUrl) {
        notifier
          .subscribe(topic, callbackUrl)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic or callback URL');
      }
    });

    app.post('/api/notifying/unsubscribe/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const { callbackUrl } = req.body;
      if (topic && callbackUrl) {
        notifier
          .unsubscribe(topic, callbackUrl)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic or callback URL');
      }
    });

    app.post('/api/notifying/notify/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const { message } = req.body;
      if (topic && message) {
        notifier
          .notify(topic, message)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing recipient or message');
      }
    });

    app.get('/api/notifying/status', (req, res) => {
      eventEmitter.emit('api-notifying-status', 'notifying api running');
      res.status(200).json('notifying api running');
    });
  }
};
