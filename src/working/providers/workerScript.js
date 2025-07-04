/**
 * @fileoverview Worker thread script for executing user-defined tasks.
 */

const { parentPort } = require('worker_threads');

let userScriptPath = null;
let userScript = null;
let status = 'idle'; // idle, running, completed, error

/**
 * Updates the status of the worker and sends a message to the parent port.
 * @param {string} newStatus The new status of the worker.
 * @param {*=} data Optional data to send with the status.
 */
function updateStatus(newStatus, data) {
  status = newStatus;
  parentPort.postMessage({ type: 'status', status: newStatus, data: data });
}

parentPort.on('message', async (message) => {
  if (message.type === 'start' && message.scriptPath) {
    userScriptPath = message.scriptPath;
    try {
      userScript = require(userScriptPath);
      updateStatus('running');
      const result = await userScript.run();
      updateStatus('completed', result);
    } catch (error) {
      updateStatus('error', error.message);
    }
  } else if (message.type === 'getStatus') {
    parentPort.postMessage({ type: 'currentStatus', status: status });
  }
});
