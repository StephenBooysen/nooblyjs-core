---
type: Learning Guide
title: '10: Working'
description: Write an activity, run it in a worker thread, read its result, and understand the limits that keep activities safe.
---

# 10: Working

**Time:** about 20 minutes · **Example:** [`examples/10-working.js`](examples/10-working.js) · **Run:** `node .claude/learning/examples/10-working.js`

## What you will learn

Write an activity, run it in a worker thread, read its result, and understand the limits that keep activities safe.

## Key ideas

- **An activity is a small script.** It is a CommonJS module that exports `run(data)`. Whatever `run` returns is the result.
- **Activities run off the request path.** Each one runs in a worker thread, so a slow activity does not block your HTTP requests.
- **A bounded pool.** At most `maxThreads` workers run at once. Other tasks wait in a queue.
- **Scripts come from one folder.** Relative names resolve inside the activities folder. A path that climbs out of it is refused. Absolute paths need `allowAbsolutePaths`, which you should not turn on in production.
- **The folder must not hold uploads.** A working service refuses an activities folder that overlaps any filing store, because scripts must never be writable by users.
- **Activities can use the other services.** The worker starts the registry, so an activity can call `registry.logger(...)` and the rest.

## Walk-through

### Write an activity

Create `greet.js` in the activities folder:

```javascript
exports.run = async (data) => ({ greeting: `Hello, ${data.name}` });
```

### Start the service

```javascript
const working = registry.working('memory', { activitiesFolder });
```

### Run it and read the result

```javascript
working.start('greet.js', { name: 'Ada' }, (status, data) => {
  // status: 'completed' or 'error'; data: the return value, or the error message
  console.log(status, data);
});
```

The completion callback is called once, when the activity finishes. The example wraps it in a promise so it can `await` the result.

### A failing activity

If `run` throws, the callback receives `status: 'error'` and the error message. The worker is cleaned up either way.

### A script outside the folder

```javascript
await working.start('../../index.js', {}, () => {});
// Error: Path traversal detected: path is outside the base directory
```

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/working/api/run` | Start a task: `{ activity, data }` for a named activity, or `{ scriptPath, data }` |
| GET | `/services/working/api/status` | Is the service running, and how many tasks |
| GET | `/services/working/api/task/:taskId` | The status and result of one task |
| GET | `/services/working/api/history` | Recent tasks |
| GET | `/services/working/api/stats` | Counts |
| GET | `/services/working/api/analytics` | Analytics for the dashboard |
| GET | `/services/working/api/stop` | Stop the processor |
| GET/POST | `/services/working/api/settings` | Read or change settings |

A run started over REST returns a task id. Poll `/task/:taskId` for the result, or read it from `/history`.

## Providers

| Type | Use it for |
|---|---|
| `default` | Worker threads in this process |
| `api` | Send tasks to a remote working service |

## Options and settings that matter

- `maxThreads` (factory option, default 4): how many activities run at once. Start with the number of CPU cores.
- `allowAbsolutePaths` (factory option, default off): lets a script be named by an absolute path. Leave it off.
- `workerTimeout`, `maxQueueSize` and `callbackTimeout` (runtime settings, changed through `POST /services/working/api/settings`): how long a worker may run, how many tasks may wait, and how long a completion callback may take.

## Common mistakes

- **Doing I/O-heavy work in a loop of activities.** A worker thread is cheap but not free. Batch the work into one activity.
- **Putting activities where users can write.** Anyone who can write a script can run code in your process. Keep the folder read-only for the app's users.
- **Expecting the result synchronously.** `start` returns before the activity finishes. Use the callback, or poll the task.
- **Passing big objects as `data`.** The data is copied to the worker. Pass an id and let the activity load the rest.
- **Forgetting that a worker has the whole registry.** It can write to your database too. Give an activity only the work it needs.

## Try it

1. Add an activity that returns `data.a + data.b`, then run it with two numbers.
2. Make an activity throw for an empty name and check the `error` status.
3. Set `maxThreads` to 1 and start three activities. Explain the order they finish in.
