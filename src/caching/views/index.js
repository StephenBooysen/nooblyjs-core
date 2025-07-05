const express = require('express');

/**
 * Caching site.
 * @param {object} options - The options object.
 * @param {object} options.express-app - The Express app instance.
 * @param {object} cache - The caching provider.
 */
module.exports = (options, eventEmitter, cache) => {
    if (options['express-app']) {
        console.log(__dirname + '/public');
        options['express-app'].use('/views/caching/', express.static(__dirname + '/public'))
    }
};
