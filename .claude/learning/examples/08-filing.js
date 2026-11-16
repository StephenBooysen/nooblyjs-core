'use strict';
// Example 08: the filing service: files in a storage root.
const path = require('node:path');
const { registry, call, done, dataDir, serve, API_KEY } = require('./setup');

(async () => {
  // The storage root. Nothing outside it can be read or written: paths that
  // climb out with '..' or sit outside the root are refused.
  const baseDir = path.join(dataDir, 'files-08');
  const filing = registry.filing('local', { baseDir });

  // Create, read and update a file. Paths are relative to the root.
  await filing.create('reports/q1.txt', 'Revenue up 12%');
  console.log('read', await filing.read('reports/q1.txt', 'utf8'));
  await filing.update('reports/q1.txt', 'Revenue up 14% (revised)');
  console.log('after update', await filing.read('reports/q1.txt', 'utf8'));

  // List a folder: names, types, sizes and dates.
  console.log('list', (await filing.list('reports')).map((item) => `${item.name} (${item.size} bytes)`));

  // A path that escapes the root is refused before any disk access.
  try {
    await filing.read('../../etc/passwd', 'utf8');
  } catch (err) {
    console.log('escape refused:', err.message.split('.')[0]);
  }

  // Over REST: uploads are multipart forms with the file in the 'file' field.
  // The size and type limits come from the filing settings.
  const base = await serve();
  const form = new FormData();
  form.append('file', new Blob(['Q2 numbers'], { type: 'text/plain' }), 'q2.txt');
  const uploaded = await fetch(`${base}/services/filing/api/upload/reports/q2.txt`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY },
    body: form,
  });
  console.log('rest upload', uploaded.status);
  const download = await call('GET', '/services/filing/api/download/reports/q2.txt');
  console.log('rest download', download.status, download.body);

  // Browse a folder over REST.
  const browse = await call('GET', '/services/filing/api/browse/reports');
  console.log('rest browse', browse.status, Array.isArray(browse.body) ? browse.body.map((i) => i.name) : browse.body);

  await filing.delete('reports/q1.txt');
  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
