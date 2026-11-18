/**
 * @fileoverview Example scheduled task for testing scheduler functionality.
 *
 * This example task demonstrates the structure and interface expected by
 * the scheduler service. It provides a simple implementation that uses
 * the service registry to access the logger and other NooblyJS Services.
 *
 * Note: This activity uses the global serviceRegistry to access services
 * because service instances cannot be passed through worker threads.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const serviceRegistry = require('../../../index');

/**
 * Runs the example scheduled task.
 *
 * This function demonstrates the basic structure of a scheduled task.
 * It uses the logger service to log execution time and returns a completion message.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the scheduler
 * @returns {Promise<string>} A promise that resolves with a completion message
 */
async function run(data) {
  // Get logger from service registry
  const logger = serviceRegistry.logger();

  const timestamp = new Date().toISOString();

  logger.info('Scheduled task executed', { timestamp, data });

  const result = `Scheduled task completed at: ${timestamp}`;

  logger.info('Scheduled task result', { result });

  return result;
}

module.exports = { run };
