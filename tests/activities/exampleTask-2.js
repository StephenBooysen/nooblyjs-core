/**
 * @fileoverview Example worker task for testing worker thread functionality.
 *
 * This example task demonstrates the structure and interface expected by
 * the worker service. It provides a simple implementation that simulates
 * async work and uses the service registry to access NooblyJS services.
 *
 * Note: This activity uses the global serviceRegistry to access services
 * because service instances cannot be passed through worker threads.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const serviceRegistry = require('../index');

/**
 * Runs the example worker task.
 *
 * This function demonstrates the basic structure of a worker task.
 * It simulates asynchronous work with a timeout and returns a completion message.
 * Uses the service registry to access logger and other services.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {
  // Get logger from service registry
  const logger = serviceRegistry.logger();

  logger.info('Example task 2 started with data:', data);

  return new Promise((resolve) => {
    setTimeout(() => {
      const result = {
        'message': 'Example task 2 completed successfully! Yay!',
        'receivedData': data,
        'processedAt': new Date().toISOString()
      };

      logger.info('Example task 2 completed', result);

      resolve(result);
    }, 5000); // 5 second delay
  });
}

module.exports = {
  run,
};
