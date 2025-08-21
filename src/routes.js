
const express = require('express');
const path = require('path');

module.exports = (app) => {
    // Serve the service registry landing page
    app.get('/services/', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });
};
