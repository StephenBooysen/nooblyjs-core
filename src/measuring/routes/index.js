/**
 * Measuring routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.measuring - The measuring provider.
 */
module.exports = (options, eventEmitter, measuring) => {

  if (options['express-app'] && measuring) {
    const app = options['express-app'];

    app.post('/api/measuring/add', (req, res) => {
      const { metric, value } = req.body;
      if (metric && value) {
        measuring
          .add(metric, value)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing metric or value');
      }
    });
        
    app.get('/api/measuring/list/:metric/:datestart/:dateend', (req, res) => {
      measuring
        .list(req.params.metric, new Date(req.params.datestart), new Date(req.params.dateend))
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/measuring/total/:metric/:datestart/:dateend', (req, res) => {
      measuring
        .total(req.params.metric, new Date(req.params.datestart), new Date(req.params.dateend))
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/measuring/average/:metric/:datestart/:dateend', (req, res) => {
      measuring
        .average(req.params.metric, new Date(req.params.datestart), new Date(req.params.dateend))
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/measuring/status', (req, res) => {
      eventEmitter.emit('api-measuring-status', 'measuring api running');
      res.status(200).json('measuring api running');
    });
  }
};
