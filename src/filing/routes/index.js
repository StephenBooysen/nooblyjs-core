/**
 * Filing routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.filing - The filing provider.
 */
module.exports = (options, eventEmitter, filing) => {

  if (options['express-app'] && filing) {
    const app = options['express-app'];

    app.post('/services/filing/api/upload/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      filing
        .upload(key, value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/services/filing/api/download/:key', (req, res) => {
      const key = req.params.key;
      filing
        .download(key)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.delete('/services/filing/api/remove/:key', (req, res) => {
      const key = req.params.key;
      filing
        .remove(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/services/filing/api/status', (req, res) => {
      eventEmitter.emit('api-filing-status', 'filing api running');
      res.status(200).json('filing api running');
    });
  }
};
