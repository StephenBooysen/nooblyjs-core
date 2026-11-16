'use strict';
// Example 11: the scheduling service: interval and cron tasks that run activities.
const fs = require('node:fs');
const path = require('node:path');
const { registry, done, dataDir } = require('./setup');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // Scheduling starts activities through the working service, so create the
  // working service with the activities folder first.
  const activitiesFolder = path.join(dataDir, 'activities-11');
  fs.mkdirSync(activitiesFolder, { recursive: true });
  fs.writeFileSync(
    path.join(activitiesFolder, 'heartbeat.js'),
    "exports.run = async (data) => ({ beat: data.beat, at: new Date().toISOString() });\n"
  );
  registry.working('memory', { activitiesFolder });

  // There is one scheduler per process. Calling registry.scheduling() again
  // returns the same instance.
  const scheduler = registry.scheduling('memory');

  // Interval task: fires now, then every 1 second, with this data.
  let beats = 0;
  await scheduler.start('heartbeat', 'heartbeat.js', { beat: 'tick' }, 1, (status, data) => {
    beats += 1;
    console.log('heartbeat', status, data);
  });

  // Cron task: a standard 5-field expression. It fires at the next matching
  // minute, so this example only registers it and then reads its details.
  await scheduler.startCron(
    { scriptPath: 'heartbeat.js', data: { beat: 'nightly' } },
    '0 2 * * *',
    'nightly-report'
  );

  await wait(2500);
  await scheduler.pause('heartbeat');
  console.log('paused; runs so far', beats);
  await scheduler.resume('heartbeat');

  // Inspect the schedule and its recent runs.
  console.log('schedules', (await scheduler.listSchedules()).map((s) => s.name ?? s.taskName));
  const runs = await scheduler.listRuns({ taskName: 'heartbeat' });
  console.log('runs for heartbeat', runs.total, 'latest status', runs.runs[0]?.status);
  console.log('stats', await scheduler.getStats());

  // Clean up: stop both tasks so the process can exit.
  await scheduler.cancel('heartbeat');
  await scheduler.cancel('nightly-report');
  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
