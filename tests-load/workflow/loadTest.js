const createWorkflowService = require('../../src/workflow');
const EventEmitter = require('events');
const path = require('path');

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
