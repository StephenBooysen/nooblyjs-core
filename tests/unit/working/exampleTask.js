/**
 * @fileoverview Example worker task for testing worker thread functionality.
 * 
 * This example task demonstrates the structure and interface expected by
 * the worker service. It provides a simple implementation that simulates
 * async work and communicates with the parent thread.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { parentPort } = require('worker_threads');

/**
 * Runs the example worker task.
 * 
 * This function demonstrates the basic structure of a worker task.
 * It simulates asynchronous work with a timeout and returns a completion message.
 * 
 * @async
 * @function run
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({'message': 'Example task completed successfully! Yay!'});
    }, 1000);
  });
}

module.exports = {
  run,
};
