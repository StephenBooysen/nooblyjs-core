'use strict';
// Example 12: the workflow service: named sequences of activities.
const fs = require('node:fs');
const path = require('node:path');
const { registry, call, done, dataDir } = require('./setup');

(async () => {
  // Workflow steps are activities, so the working service comes first.
  const activitiesFolder = path.join(dataDir, 'activities-12');
  fs.mkdirSync(activitiesFolder, { recursive: true });
  fs.writeFileSync(path.join(activitiesFolder, 'validate.js'),
    "exports.run = async (data) => ({ valid: data.orderId !== undefined });\n");
  fs.writeFileSync(path.join(activitiesFolder, 'charge.js'),
    "exports.run = async (data) => ({ charged: data.amount ?? 0, orderId: data.orderId });\n");
  registry.working('memory', { activitiesFolder });

  const workflow = registry.workflow('memory');

  // Define a workflow: a name and an ordered list of steps.
  await workflow.defineWorkflow('order-flow', ['validate.js', 'charge.js']);

  // Run it. The status callback reports progress as each step finishes.
  const execution = await workflow.runWorkflow(
    'order-flow',
    { orderId: 'ord-1001', amount: 49.99 },
    (status) => console.log('status', status.status ?? status)
  );
  console.log('finished with', execution.status, 'output', execution.outputData);

  // Every run is kept in the history for the workflow.
  const history = workflow.listExecutions('order-flow');
  console.log('history entries', history.executions.length);

  // The whole state (definitions, history and schedules) can be exported and
  // restored after a restart. The host saves it when workflow:state:changed fires.
  const snapshot = workflow.exportState();
  console.log('snapshot keys', Object.keys(snapshot));

  // Over REST: list the workflows and run one.
  const list = await call('GET', '/services/workflow/api/workflows');
  console.log('rest workflows', list.status, Array.isArray(list.body) ? list.body.length : list.body);
  const run = await call('POST', '/services/workflow/api/workflows/order-flow/execute', { input: { orderId: 'ord-1002', amount: 5 } });
  console.log('rest execute', run.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
