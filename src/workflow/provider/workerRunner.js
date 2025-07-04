/**
 * @fileoverview Worker runner for executing individual workflow steps.
 */

const { parentPort, workerData } = require('worker_threads');

async function runStep() {
  const { stepPath, data } = workerData;
  try {
    // Dynamically import the step file and execute its default export
    const stepModule = require(stepPath);
    const result = await stepModule(data);
    parentPort.postMessage({ type: 'result', data: result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
}

runStep();
