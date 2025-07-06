/**
 * Scheduling routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.scheduler - The scheduling provider.
 */
module.exports = (options, eventEmitter, scheduler) => {

  if (options['express-app'] && scheduler) {
    const app = options['express-app'];

    app.post('/api/scheduling/schedule', (req, res) => {
      const { task, cron } = req.body;
      if (task && cron) {
        scheduler
          .start(task, cron)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task or cron expression');
      }
    });

    app.delete('/api/scheduling/cancel/:taskId', (req, res) => {
      const taskId = req.params.taskId;
      scheduler
        .cancel(taskId)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/scheduling/status', (req, res) => {
      eventEmitter.emit('api-scheduling-status', 'scheduling api running');
      res.status(200).json('scheduling api running');
    });
  }
};
