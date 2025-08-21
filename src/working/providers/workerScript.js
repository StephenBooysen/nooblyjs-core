/**
 * @fileoverview Worker thread script for executing user-defined tasks
 * with status tracking and message-based communication with the parent thread.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { parentPort } = require('worker_threads');

/** @type {?string} */
let userScriptPath = null;
/** @type {?Object} */
let userScript = null;
/** @type {string} */
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

/**
 * Handles incoming messages from the parent thread.
 * Supports 'start' and 'getStatus' message types.
 */
parentPort.on('message', async (message) => {
  if (message === null) {
    return;
  }
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
