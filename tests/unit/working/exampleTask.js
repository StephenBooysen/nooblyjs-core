/**
 * @fileoverview An example task to be executed by the worker thread.
 */

/**
 * Runs the example task.
 * @return {!Promise<string>} A promise that resolves with a completion message.
 */
const { parentPort } = require('worker_threads');

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
