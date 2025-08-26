/**
 * @fileoverview Data serving API routes for Express.js application.
 * Provides RESTful endpoints for data storage and retrieval operations
 * including put, get, delete, and status monitoring.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers data serving routes with the Express application.
 * Sets up endpoints for persistent data management operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} dataserve - The data serving provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, dataserve) => {
  if (options['express-app'] && dataserve) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;

    /**
     * POST /services/dataserve/api/:container
     * Adds data to a container and returns the generated UUID.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to store the data in
     * @param {*} req.body - The data to store
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataserve/api/:container', authMiddleware || ((req, res, next) => next()), async (req, res) => {
      const container = req.params.container;
      const jsonObject = req.body;
      
      try {
        // Ensure container exists
        await dataserve.createContainer(container);
      } catch (err) {
        // Container may already exist, ignore error
      }
      
      dataserve
        .add(container, jsonObject)
        .then((uuid) => res.status(200).json({ id: uuid }))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataserve/api/:container/:uuid
     * Retrieves data by UUID from a specific container in the data serving system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to retrieve data from
     * @param {string} req.params.uuid - The UUID to retrieve data for
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataserve/api/:container/:uuid', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const container = req.params.container;
      const uuid = req.params.uuid;
      dataserve
        .getByUuid(container, uuid)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * DELETE /services/dataserve/api/:container/:uuid
     * Removes data by UUID from a specific container in the data serving system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to delete data from
     * @param {string} req.params.uuid - The UUID to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/dataserve/api/:container/:uuid', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const container = req.params.container;
      const uuid = req.params.uuid;
      dataserve
        .remove(container, uuid)
        .then((success) => {
          if (success) {
            res.status(200).send('OK');
          } else {
            res.status(404).send('Not found');
          }
        })
        .catch((err) => res.status(500).send(err.message));
    });


    /**
     * POST /services/dataserve/api/jsonFind/:containerName
     * Searches for objects in a container using a JavaScript predicate function.
     * The request body should contain the predicate as a string.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.containerName - The container to search in
     * @param {Object} req.body - Request body containing predicate string
     * @param {string} req.body.predicate - JavaScript predicate function as string
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataserve/api/jsonFind/:containerName', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const { predicate } = req.body;

      try {
        // Create predicate function from string (be careful with eval in production)
        const predicateFunc = new Function('obj', `return ${predicate}`);
        
        dataserve
          .jsonFind(containerName, predicateFunc)
          .then((results) => res.status(200).json(results))
          .catch((err) => res.status(500).send(err.message));
      } catch (err) {
        res.status(400).send(`Invalid predicate: ${err.message}`);
      }
    });

    /**
     * GET /services/dataserve/api/jsonFindByPath/:containerName/:path/:value
     * Searches for objects in a container where a specific path matches a value.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.containerName - The container to search in
     * @param {string} req.params.path - The dot-notation path to search (e.g., 'user.profile.name')
     * @param {string} req.params.value - The value to match
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataserve/api/jsonFindByPath/:containerName/:path/:value', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const path = req.params.path;
      const value = req.params.value;

      dataserve
        .jsonFindByPath(containerName, path, value)
        .then((results) => res.status(200).json(results))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * POST /services/dataserve/api/jsonFindByCriteria/:containerName
     * Searches for objects in a container using multiple criteria.
     * The request body should contain an object with path-value pairs.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.containerName - The container to search in
     * @param {Object} req.body - Request body containing criteria object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataserve/api/jsonFindByCriteria/:containerName', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const criteria = req.body;

      dataserve
        .jsonFindByCriteria(containerName, criteria)
        .then((results) => res.status(200).json(results))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataserve/api/status
     * Returns the operational status of the data serving service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataserve/api/status', (req, res) => {
      eventEmitter.emit('api-dataserve-status', 'dataserve api running');
      res.status(200).json('dataserve api running');
    });
  }
};
