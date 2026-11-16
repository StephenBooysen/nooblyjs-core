# 11: Scheduling

**Time:** about 20 minutes · **Example:** [`examples/11-scheduling.js`](examples/11-scheduling.js) · **Run:** `node .claude/learning/examples/11-scheduling.js`

## What you will learn

Run an activity every few seconds, or on a cron schedule, pause and resume it, and read its run history.

## Key ideas

- **Scheduling starts activities.** A schedule names an activity script and the data to pass it. The working service does the running (tutorial 10), so create the working service first.
- **Two kinds of schedule.** An *interval* fires now, then every N seconds. A *cron* schedule fires when a standard 5-field expression matches: minute, hour, day of month, month, day of week.
- **One scheduler per process.** `registry.scheduling()` returns the same instance everywhere in the process, so every part of your app sees the same schedules.
- **Pause is not catch-up.** Minutes that pass while a schedule is paused are not replayed when it resumes.
- **History is kept.** The last 50 runs per task are kept, including fires that were skipped because the concurrency cap was reached.

## Walk-through

### Set up the activity and the working service

```javascript
registry.working('memory', { activitiesFolder });
const scheduler = registry.scheduling('memory');
```

### An interval schedule

```javascript
await scheduler.start('heartbeat', 'heartbeat.js', { beat: 'tick' }, 1, (status, data) => {
  console.log('heartbeat', status, data);
});
```

The arguments are: a unique name, the script, the data, the interval in seconds, and an optional callback that receives each run's status and result.

### A cron schedule

```javascript
await scheduler.startCron(
  { scriptPath: 'heartbeat.js', data: { beat: 'nightly' } },
  '0 2 * * *',          // every day at 02:00
  'nightly-report'
);
```

Some useful expressions:

```
*/5 * * * *    every five minutes
0 * * * *      at the top of every hour
0 2 * * *      every day at 02:00
0 0 * * 0      every Sunday at midnight
```

### Pause, resume and inspect

```javascript
await scheduler.pause('heartbeat');
await scheduler.resume('heartbeat');

const { runs, total } = await scheduler.listRuns({ taskName: 'heartbeat' });
console.log(total, runs[0]?.status);
console.log(await scheduler.getStats());
```

### Clean up

```javascript
await scheduler.cancel('heartbeat');
```

Cancel schedules you no longer need. A forgotten interval keeps running for as long as the process lives.

## Over REST

The manager routes manage named tasks:

| Method | Path | Purpose |
|---|---|---|
| GET | `/services/scheduling/api/tasks` | List tasks |
| POST | `/services/scheduling/api/tasks` | Create a task: `{ name, scriptPath, data, cron or intervalSeconds, enabled, description, group }` |
| GET | `/services/scheduling/api/tasks/stats` | Summary counts |
| GET | `/services/scheduling/api/tasks/:name` | One task |
| PUT | `/services/scheduling/api/tasks/:name` | Change a task (cron and interval can be switched) |
| DELETE | `/services/scheduling/api/tasks/:name` | Remove a task |
| POST | `/services/scheduling/api/tasks/:name/toggle` | Pause or resume |
| POST | `/services/scheduling/api/tasks/:name/run-now` | Run once, now |
| GET | `/services/scheduling/api/runs` | Run history (filter by `taskName`, `status`) |
| GET | `/services/scheduling/api/runs/:id` | One run |
| GET | `/services/scheduling/api/cron/preview` | The next fire times for an expression |

The script must be inside the activities folder, the same rule as tutorial 10. Creating a task with an unsafe script path returns `400`.

## Providers

| Type | Notes |
|---|---|
| `memory` | The in-process scheduler (the registry's default) |

## Common mistakes

- **Expecting the schedule to survive a restart.** Schedules live in memory. Re-create them at start-up, or keep the definitions in settings and load them.
- **Running several replicas of an app with the same schedules.** Each replica fires its own copy. Coordinate with a lock or run the scheduler in one place (see the horizontal scaling feature in the roadmap).
- **Using the wrong cron field order.** The first field is the minute, not the second. Check the next fire times with `cron/preview` before you rely on an expression.
- **Doing long work inside the callback.** The callback runs when a run finishes. Start an activity or enqueue a job from it instead.
- **Forgetting to cancel.** An interval started in a test keeps the test process alive.

## Try it

1. Start an interval of 2 seconds, pause it for 5 seconds, then resume. Count the runs in the history.
2. Create a cron task over REST for every minute and read its next fire times with the cron preview.
3. Switch an interval task to cron with `PUT` and check that its history is kept.
