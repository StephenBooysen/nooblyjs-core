/**
 * @fileoverview Worker thread script for executing user-defined tasks
 * with status tracking and message-based communication with the parent thread.
 * Initializes the serviceRegistry to allow activities to access NooblyJS Services.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { parentPort } = require('worker_threads');
const express = require('express');

// Initialize serviceRegistry in the worker thread context
// Worker threads need their own Express app instance for the registry
const serviceRegistry = require('../../../index');
const workerApp = express();

// Initialize the service registry with the worker's Express app
// This allows activities to access services via serviceRegistry.logger(), etc.
try {
  serviceRegistry.initialize(workerApp);
} catch (error) {
  // Registry might already be initialized, which is fine (silently ignore)
}

/** @type {?string} */
let userScriptPath = null;
/** @type {?Object} */
let userScript = null;
/** @type {string} */
let status = 'idle'; // idle, running, completed, error

// Settings for working service worker script
const settings = {};
settings.description = "Configuration settings for the Working Service Worker Script";
settings.list = [
  {setting: "executionTimeout", type: "number", values: [300000]},
  {setting: "maxMemory", type: "number", values: [512]},
  {setting: "maxRetries", type: "number", values: [3]}
];
settings.executionTimeout = settings.list[0].values[0];
settings.maxMemory = settings.list[1].values[0];
settings.maxRetries = settings.list[2].values[0];

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
      // Pass the data to the user script's run function
      const result = await userScript.run(message.data);
      updateStatus('completed', result);
    } catch (error) {
      updateStatus('error', error.message);
    }
  } else if (message.type === 'getStatus') {
    parentPort.postMessage({ type: 'currentStatus', status: status });
  } else if (message.type === 'getSettings') {
    parentPort.postMessage({ type: 'settings', settings: settings });
  } else if (message.type === 'saveSettings') {
    for (let i = 0; i < settings.list.length; i++){
      if (message.settings[settings.list[i].setting] != null){
        settings[settings.list[i].setting] = message.settings[settings.list[i].setting];
        // Worker thread - logging unavailable, silently apply settings
      }
    }
    parentPort.postMessage({ type: 'settingsSaved', settings: settings });
  }
});
