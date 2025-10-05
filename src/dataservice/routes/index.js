/**
 * @fileoverview Data service API routes for Express.js application.
 * Provides RESTful endpoints for data storage and retrieval operations
 * including put, get, delete, and status monitoring.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers data service routes with the Express application.
 * Sets up endpoints for persistent data management operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} dataservice - The data service provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, dataservice) => {
  if (options['express-app'] && dataservice) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;

    /**
     * POST /services/dataservice/api/:container
     * Adds data to a container and returns the generated UUID.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to store the data in
     * @param {*} req.body - The data to store
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataservice/api/:container', authMiddleware || ((req, res, next) => next()), async (req, res) => {
      const container = req.params.container;
      const jsonObject = req.body;

      try {
        // Ensure container exists
        await dataservice.createContainer(container);
      } catch (err) {
        // Container may already exist, ignore error
      }

      dataservice
        .add(container, jsonObject)
        .then((uuid) => res.status(200).json({ id: uuid }))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataservice/api/:container/:uuid
     * Retrieves data by UUID from a specific container in the data service system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to retrieve data from
     * @param {string} req.params.uuid - The UUID to retrieve data for
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataservice/api/:container/:uuid', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const container = req.params.container;
      const uuid = req.params.uuid;
      dataservice
        .getByUuid(container, uuid)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * DELETE /services/dataservice/api/:container/:uuid
     * Removes data by UUID from a specific container in the data service system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.container - The container to delete data from
     * @param {string} req.params.uuid - The UUID to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/dataservice/api/:container/:uuid', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const container = req.params.container;
      const uuid = req.params.uuid;
      dataservice
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
     * POST /services/dataservice/api/jsonFind/:containerName
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
    app.post('/services/dataservice/api/jsonFind/:containerName', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const { predicate } = req.body;

      try {
        // Create predicate function from string (be careful with eval in production)
        const predicateFunc = new Function('obj', `return ${predicate}`);

        dataservice
          .jsonFind(containerName, predicateFunc)
          .then((results) => res.status(200).json(results))
          .catch((err) => res.status(500).send(err.message));
      } catch (err) {
        res.status(400).send(`Invalid predicate: ${err.message}`);
      }
    });

    /**
     * GET /services/dataservice/api/jsonFindByPath/:containerName/:path/:value
     * Searches for objects in a container where a specific path matches a value.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.containerName - The container to search in
     * @param {string} req.params.path - The dot-notation path to search (e.g., 'user.profile.name')
     * @param {string} req.params.value - The value to match
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataservice/api/jsonFindByPath/:containerName/:path/:value', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const path = req.params.path;
      const value = req.params.value;

      dataservice
        .jsonFindByPath(containerName, path, value)
        .then((results) => res.status(200).json(results))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * POST /services/dataservice/api/jsonFindByCriteria/:containerName
     * Searches for objects in a container using multiple criteria.
     * The request body should contain an object with path-value pairs.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.containerName - The container to search in
     * @param {Object} req.body - Request body containing criteria object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataservice/api/jsonFindByCriteria/:containerName', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const containerName = req.params.containerName;
      const criteria = req.body;

      dataservice
        .jsonFindByCriteria(containerName, criteria)
        .then((results) => res.status(200).json(results))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataservice/api/status
     * Returns the operational status of the data service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataservice/api/status', (req, res) => {
      eventEmitter.emit('api-dataservice-status', 'dataservice api running');
      res.status(200).json('dataservice api running');
    });
  }
};
