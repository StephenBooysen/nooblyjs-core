
/**
 * Workflow routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.workflow - The workflow provider.
 */
module.exports = (options, eventEmitter, workflow) => {
  eventEmitter.emit('instance', { options: options });
  if (options['express-app'] && workflow) {
    const app = options['express-app'];

    app.post('/api/workflow/start', (req, res) => {
      const { name, data } = req.body;
      if (name) {
        workflow.start(name, data)
          .then((workflowId) => res.status(200).json({ workflowId }))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing workflow name');
      }
    });

    app.get('/api/workflow/status/:workflowId', (req, res) => {
      const workflowId = req.params.workflowId;
      workflow.getStatus(workflowId)
        .then((status) => res.status(200).json(status))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/workflow/status', (req, res) => {
      eventEmitter.emit("api-workflow-status","workflow api running");
      res.status(200).json("running");
    });
  }
};
