'use strict';
// Example 10: the working service: activities run in worker threads.
const fs = require('node:fs');
const path = require('node:path');
const { registry, done, dataDir } = require('./setup');

/**
 * Runs an activity and resolves with its final status and result.
 * @param {Object} working The working service
 * @param {string} script Script name, relative to the activities folder
 * @param {*} input Data passed to the activity's run() function
 * @return {Promise<{status: string, data: *}>}
 */
function runActivity(working, script, input) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 15000);
    working.start(script, input, (status, data) => {
      if (status === 'completed' || status === 'error') {
        clearTimeout(timer);
        resolve({ status, data });
      }
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

(async () => {
  // Activities live in one folder. Relative script names resolve inside it.
  const activitiesFolder = path.join(dataDir, 'activities-10');
  fs.mkdirSync(activitiesFolder, { recursive: true });

  // An activity exports run(data). Whatever run() returns is the result.
  fs.writeFileSync(
    path.join(activitiesFolder, 'greet.js'),
    "exports.run = async (data) => ({ greeting: `Hello, ${data.name}` });\n"
  );
  fs.writeFileSync(
    path.join(activitiesFolder, 'fail.js'),
    "exports.run = async () => { throw new Error('bad input'); };\n"
  );

  const working = registry.working('memory', { activitiesFolder });

  console.log('greet', await runActivity(working, 'greet.js', { name: 'Ada' }));
  console.log('fail', await runActivity(working, 'fail.js', {}));

  // A script outside the activities folder is refused before it runs.
  try {
    await working.start('../../index.js', {}, () => {});
  } catch (err) {
    console.log('outside folder refused:', err.message);
  }

  // Over REST, a run is started with POST /services/working/api/run.
  // The result comes back through the history and task routes.

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
