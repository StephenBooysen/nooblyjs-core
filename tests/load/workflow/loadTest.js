/**
 * @fileoverview Load test for workflow service performance.
 * 
 * This load test measures the performance of workflow execution including
 * workflow definition, step execution, and data flow management. Tests help
 * evaluate workflow throughput and step execution performance.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createWorkflowService = require('../../../src/workflow');
const EventEmitter = require('events');
const path = require('path');

/**
 * Executes load test for workflow service performance.
 * 
 * Creates mock workflow steps and runs workflow executions to measure
 * performance characteristics of workflow processing under load.
 * 
 * @async
 * @function runWorkflowLoadTest
 * @param {number} iterations - Number of workflow executions to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
async function runWorkflowLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const workflowService = createWorkflowService('default', {}, eventEmitter);

  const step1Path = path.resolve(__dirname, './mockStep1.js');
  const step2Path = path.resolve(__dirname, './mockStep2.js');

  // Create dummy step files
  const fs = require('fs').promises;
  await fs.writeFile(
    step1Path,
    'module.exports = (data) => { data.step1 = true; return data; };',
  );
  await fs.writeFile(
    step2Path,
    'module.exports = (data) => { data.step2 = true; return data; };',
  );

  workflowService.defineWorkflow('loadTestWorkflow', [step1Path, step2Path]);

  const startTime = Date.now();
  console.log(`Starting Workflow Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    const initialData = { id: i };
    await workflowService.runWorkflow(
      'loadTestWorkflow',
      initialData,
      () => {},
    );
    if (i % 10 === 0) {
      // console.log(`Workflow iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Workflow Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );

  await fs.unlink(step1Path);
  await fs.unlink(step2Path);

  return { service: 'workflow', iterations, duration };
}

module.exports = runWorkflowLoadTest;
