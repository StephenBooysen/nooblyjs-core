/**
 * Working routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.worker - The working provider.
 */
module.exports = (options, eventEmitter, worker) => {

  if (options['express-app'] && worker) {
    const app = options['express-app'];

    app.post('/services/working/api/run', (req, res) => {
      const { task, data } = req.body;
      if (task) {
        worker
          .start(task, (data) => {
            eventEmitter.emit('worker-complete', data);
          })
          .then((result) => res.status(200).json(result))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task');
      }
    });

    app.get('/services/working/api/stop', (req, res) => {
      worker
        .stop()
        .then((result) => res.status(200).json(result))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/services/working/api/status', (req, res) => {
      eventEmitter.emit('api-working-status', 'working api running');
      res.status(200).json('working api running');
    });
  }
};
