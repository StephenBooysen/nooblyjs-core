/**
 * Queueing routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.queue - The queueing provider.
 */
module.exports = (options, eventEmitter, queue) => {
  if (options['express-app'] && queue) {
    const app = options['express-app'];

    app.post('/api/queueing/enqueue', (req, res) => {
      const { task } = req.body;
      if (task) {
        queue
          .enqueue(task)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task');
      }
    });

    app.get('/api/queueing/dequeue', (req, res) => {
      queue
        .dequeue()
        .then((task) => res.status(200).json(task))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/queueing/size', (req, res) => {
      queue
        .size()
        .then((size) => res.status(200).json(size))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/queueing/status', (req, res) => {
      eventEmitter.emit('api-queueing-status', 'queueing api running');
      res.status(200).json('queueing api running');
    });
  }
};
