/**
 * @fileoverview Dashboard for the knowledge service (feature 05): sources and
 * sync state, and a question panel with clickable citations.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.11
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Serves the dashboard page and its script.
 * @param {Object} options Service options (`express-app`).
 * @param {EventEmitter} eventEmitter Unused; kept for the view contract.
 * @param {Object} service Knowledge service.
 * @return {void}
 */
module.exports = (options, eventEmitter, service) => {
  if (options['express-app'] && service) {
    const app = options['express-app'];
    app.get('/services/knowledge', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });
    app.use('/services/knowledge', express.static(path.join(__dirname)));
  }
};
