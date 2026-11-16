'use strict';
// Example 07: the dataservice service: JSON records in named containers.
const fs = require('node:fs');
const path = require('node:path');
const { registry, call, done, dataDir } = require('./setup');

(async () => {
  // 'memory' for tests, 'file' for a JSON file under dataDir, and MongoDB,
  // DocumentDB or SimpleDB for production. The API is the same for all.
  // Start from an empty folder so the example can run again.
  const dataFolder = path.join(dataDir, 'data-07');
  fs.rmSync(dataFolder, { recursive: true, force: true });
  const data = registry.dataService('file', { dataDir: dataFolder });

  // A container is a named list of records. Create it, then add records.
  await data.createContainer('people');
  const ada = await data.add('people', { name: 'Ada', team: 'engine' });
  await data.add('people', { name: 'Grace', team: 'compilers' });
  await data.add('people', { name: 'Linus', team: 'engine' });

  // Every record gets a uuid. Read, update and remove by that uuid.
  console.log('by uuid', await data.getByUuid('people', ada.uuid ?? ada));
  await data.update('people', ada.uuid ?? ada, { name: 'Ada', team: 'analytics' });

  // Find by text (matches any field), count and list everything.
  console.log('find "engine"', await data.find('people', 'engine'));
  console.log('count', await data.count('people'));

  // Over REST: POST to a container adds a record; GET /find/:container searches.
  const created = await call('POST', '/services/dataservice/api/people', { name: 'Margaret', team: 'apollo' });
  console.log('rest add', created.status, created.body);
  const found = await call('GET', '/services/dataservice/api/find/people?q=apollo');
  console.log('rest find', found.status, found.body);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
