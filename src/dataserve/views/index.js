/**
 * Views for the dataserve service.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} dataserve - The dataserve provider.
 */

const express = require('express');
const path = require('path');

module.exports = (options, eventEmitter, dataserve) => {
  if (options['express-app'] && dataserve) {
    const app = options['express-app'];
    
    // Serve static files from the views directory
    app.use('/services/dataserve', express.static(path.join(__dirname)));
  }
};