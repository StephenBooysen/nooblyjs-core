# 12: Workflow

**Time:** about 25 minutes · **Example:** [`examples/12-workflow.js`](examples/12-workflow.js) · **Run:** `node .claude/learning/examples/12-workflow.js`

## What you will learn

Define a named sequence of activities, run it with input, read its history, and keep its state across restarts.

## Key ideas

- **A workflow is a named list of steps.** Each step is an activity from tutorial 10. Steps run in order.
- **Data flows forward.** Each step receives the original input and the outputs of the steps before it, in a `steps` list.
- **Every run is recorded.** The execution has a status (`completed`, `failed`, `interrupted`), per-step timings and output, and the history is kept per workflow (up to 1000 runs by default).
- **Workflows can run on a schedule.** A cron expression starts a run, using the same parser as the scheduling service.
- **State is portable.** `exportState()` returns the definitions, history and schedules as one object. The app saves it and restores it with `importState()`, so a restart does not lose workflows.
- **Steps are checked before a workflow is saved.** A step the working service would refuse, such as a path outside the activities folder, is rejected with `400`.

## Walk-through

### Define and run

```javascript
await workflow.defineWorkflow('order-flow', ['validate.js', 'charge.js']);

const execution = await workflow.runWorkflow(
  'order-flow',
  { orderId: 'ord-1001', amount: 49.99 },
  (status) => console.log('status', status)
);
console.log(execution.status, execution.outputData);
```

The status callback reports each step as it starts and ends, and the workflow as it completes. `runWorkflow` returns the finished execution.

### Read the history

```javascript
const history = workflow.listExecutions('order-flow');
console.log(history.executions.length);
```

### Save and restore the state

```javascript
const snapshot = workflow.exportState();
// Save `snapshot` to your database or a file, then after a restart:
workflow.importState(snapshot);
```

The service also emits `workflow:state:changed` when a definition, run or schedule changes. A common pattern is to listen for it and save the snapshot. On restore, a run that was still going becomes `interrupted`, and an overdue schedule is caught up once.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/services/workflow/api/workflows` | List workflows |
| POST | `/services/workflow/api/workflows` | Create a workflow |
| GET | `/services/workflow/api/workflows/:name` | Read one |
| PUT | `/services/workflow/api/workflows/:name` | Change one |
| DELETE | `/services/workflow/api/workflows/:name` | Remove one |
| POST | `/services/workflow/api/workflows/:name/execute` | Start a run; returns `202` with the run |
| GET | `/services/workflow/api/workflows/:name/executions` | Its run history |
| GET | `/services/workflow/api/runs` | Runs across all workflows |
| GET | `/services/workflow/api/runs/:id` | One run |
| POST | `/services/workflow/api/runs/:id/cancel` | Cancel a run |
| GET/POST | `/services/workflow/api/schedules` | List or create schedules |
| GET | `/services/workflow/api/state` | Export the state |
| PUT | `/services/workflow/api/state` | Import a state |

A run started over REST returns `202 Accepted` straight away. Poll `/runs/:id` for its progress.

## Providers

| Type | Notes |
|---|---|
| `memory` | All state in memory; the host saves and restores it with `exportState` and `importState` |
| `api` | Proxies to a remote workflow service |

## Common mistakes

- **Not saving the state.** A `memory` workflow service forgets everything on restart unless your app saves `exportState()` and restores it.
- **Expecting branches.** Steps run in a fixed order. Put the decision in a step, or choose which workflow to start in your code.
- **Building huge outputs.** Every step's output is kept in the history and the steps list. Store large results in filing or the data service and return the key.
- **Relying on a run that was interrupted.** After a restart a run in progress is marked `interrupted`, not finished. Decide what happens next in your code.
- **Assuming a schedule fires once per missed period.** An overdue schedule is caught up once, not once for every missed fire.

## Try it

1. Add a third step to the example and check that it receives the output of the first two in its `steps` list.
2. Export the state, create a new `workflow` service in a new process, import the state, and list the workflows.
3. Start a run over REST and poll `/runs/:id` until it is `completed`.
