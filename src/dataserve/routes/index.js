/**
 * Dataserve routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.dataserve - The dataserve provider.
 */
module.exports = (options, eventEmitter, dataserve) => {

  if (options['express-app'] && dataserve) {
    const app = options['express-app'];

    app.post('/api/dataserve/put/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      dataserve
        .put(key, value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/dataserve/get/:key', (req, res) => {
      const key = req.params.key;
      dataserve
        .get(key)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    app.delete('/api/dataserve/delete/:key', (req, res) => {
      const key = req.params.key;
      dataserve
        .delete(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    app.get('/api/dataserve/status', (req, res) => {
      eventEmitter.emit('api-dataserve-status', 'dataserve api running');
      res.status(200).json('running');
    });
  }
};
