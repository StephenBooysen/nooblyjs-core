/**
 * @fileoverview This file defines the routes for the searching API in an Express application.
 */
'use strict';
const crypto = require('crypto');

/**
 * Searching routes for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} options.search - The searching provider.
 */
module.exports = (options, eventEmitter, search) => {

  if (options['express-app'] && search) {
    const app = options['express-app'];

    app.post('/api/searching/add/', (req, res) => {
      const key = crypto.randomUUID();
      const value = req.body;
      if (search.add(key, value)) {
        res.status(200).send('OK');
      } else {
        res.status(400).send('Bad Request: Key already exists.');
      }
    });

    app.delete('/api/searching/delete/:key', (req, res) => {
      const key = req.params.key;
      if (search.remove(key)) {
        res.status(200).send('OK');
      } else {
        res.status(404).send('Not Found: Key not found.');
      }
    });

    app.get('/api/searching/search/:term', (req, res) => {
      const term = req.params.term;
      if (term) {
        search
          .search(term)
          .then((results) => res.status(200).json(results))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing query');
      }
    });

    app.get('/api/searching/status', (req, res) => {
      eventEmitter.emit('api-searching-status', 'searching api running');
      res.status(200).json('searching api is running');
    });
  }
};
