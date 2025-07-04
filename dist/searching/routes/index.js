/**
 * Searching routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.search - The searching provider.
 */
module.exports = (options, eventEmitter, search) => {
  eventEmitter.emit('instance', {
    options: options
  });
  if (options['express-app'] && search) {
    const app = options['express-app'];
    app.get('/api/searching/search', (req, res) => {
      const {
        query
      } = req.query;
      if (query) {
        search.search(query).then(results => res.status(200).json(results)).catch(err => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing query');
      }
    });
    app.get('/api/searching/status', (req, res) => {
      eventEmitter.emit("api-searching-status", "searching api running");
      res.status(200).json("running");
    });
  }
};