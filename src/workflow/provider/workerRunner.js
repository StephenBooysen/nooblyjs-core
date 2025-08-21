/**
 * @fileoverview Worker runner for executing individual workflow steps
 * in separate worker threads with error handling and result communication.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');

/**
 * Executes a workflow step in a worker thread.
 * Loads and runs the specified step module with provided data.
 * @return {Promise<void>} A promise that resolves when the step execution is complete.
 */
async function runStep() {
  const { stepPath, data } = workerData;
  try {
    // Dynamically require the step file and execute its default export
    const stepModule = require(stepPath);
    const result = await stepModule(data);
    parentPort.postMessage({ type: 'result', data: result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
}

runStep();
