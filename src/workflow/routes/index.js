/**
 * Workflow routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.workflow - The workflow provider.
 */
module.exports = (options, eventEmitter, workflow) => {

  if (options['express-app'] && workflow) {
    const app = options['express-app'];

    app.post('/api/workflow/defineworkflow', (req, res) => {
      const { name, steps } = req.body;
      if (name) {
        workflow
          .defineWorkflow(name, steps)
          .then((workflowId) => res.status(200).json({ workflowId }))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing workflow name');
      }
    });

    app.post('/api/workflow/start', (req, res) => {
      const { name, data } = req.body;
      if (name) {
        workflow
          .runWorkflow(name, data, (data) => {
            eventEmitter.emit('workflow-complete', data);
          })
          .then((workflowId) => res.status(200).json({ workflowId }))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing workflow name');
      }
    });

    app.get('/api/workflow/status', (req, res) => {
      eventEmitter.emit('api-working-status', 'workflow api running');
      res.status(200).json('workflow api running');
    });
  }
};
