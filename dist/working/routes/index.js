/**
 * Working routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.worker - The working provider.
 */
module.exports = (options, eventEmitter, worker) => {
  eventEmitter.emit('instance', {
    options: options
  });
  if (options['express-app'] && worker) {
    const app = options['express-app'];
    app.post('/api/working/run', (req, res) => {
      const {
        task,
        data
      } = req.body;
      if (task) {
        worker.start(task, function (data) {
          eventEmitter.emit('worker-complete', data);
        }).then(result => res.status(200).json(result)).catch(err => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task');
      }
    });
    app.get('/api/working/stop', (req, res) => {
      worker.stop().then(result => res.status(200).json(result)).catch(err => res.status(500).send(err.message));
    });
    app.get('/api/working/status', (req, res) => {
      eventEmitter.emit("api-working-status", "working api running");
      res.status(200).json("running");
    });
  }
};