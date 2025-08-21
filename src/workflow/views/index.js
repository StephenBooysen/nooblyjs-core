/**
 * Workflow views for the Express app.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} workflow - The workflow provider.
 */
const path = require('path');
const express = require('express');

module.exports = (options, eventEmitter, workflow) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory
    app.use('/services/workflow', express.static(path.join(__dirname)));
  }
};