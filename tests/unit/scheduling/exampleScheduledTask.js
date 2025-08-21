/**
 * @fileoverview Example scheduled task for testing scheduler functionality.
 * 
 * This example task demonstrates the structure and interface expected by
 * the scheduler service. It provides a simple implementation that logs
 * execution time and returns completion status.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Runs the example scheduled task.
 * 
 * This function demonstrates the basic structure of a scheduled task.
 * It logs the execution timestamp and returns a completion message.
 * 
 * @async
 * @function run
 * @returns {Promise<string>} A promise that resolves with a completion message
 */
async function run() {
  const timestamp = new Date().toISOString();
  console.log(`Scheduled task executed at: ${timestamp}`);
  return `Scheduled task completed at: ${timestamp}`;
}

module.exports = { run };
