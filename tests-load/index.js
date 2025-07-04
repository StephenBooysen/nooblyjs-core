const runCachingLoadTest = require('./caching/loadTest');
const runDataserveLoadTest = require('./dataserve/loadTest');
const runFilingLoadTest = require('./filing/loadTest');
const runLoggingLoadTest = require('./logging/loadTest');
const runMeasuringLoadTest = require('./measuring/loadTest');
const runNotifyingLoadTest = require('./notifying/loadTest');
const runQueueingLoadTest = require('./queueing/loadTest');
const runSchedulingLoadTest = require('./scheduling/loadTest');
const runSearchingLoadTest = require('./searching/loadTest');
const runWorkflowLoadTest = require('./workflow/loadTest');
const runWorkingLoadTest = require('./working/loadTest');

async function runAllLoadTests() {
  const iterations = 100; // Adjust as needed
  const results = [];

  console.log('\n--- Running Load Tests ---');

  results.push(await runCachingLoadTest(iterations, 'memory'));
  // results.push(await runCachingLoadTest(iterations, 'redis', {url: 'redis://localhost:6379'})); // Uncomment if Redis is set up
  // results.push(await runCachingLoadTest(iterations, 'memcached', {url: 'localhost:11211'})); // Uncomment if Memcached is set up

  results.push(await runDataserveLoadTest(iterations, 'memory'));
  results.push(await runDataserveLoadTest(iterations, 'file'));
  // results.push(await runDataserveLoadTest(iterations, 'simpledb', {region: 'us-east-1'})); // Uncomment if SimpleDB is set up

  results.push(await runFilingLoadTest(iterations, 'local'));
  // results.push(await runFilingLoadTest(iterations, 'ftp', {connectionString: {host: 'localhost', port: 21, user: 'user', password: 'password'}})); // Uncomment if FTP is set up
  // results.push(await runFilingLoadTest(iterations, 's3', {bucketName: 'your-s3-bucket', region: 'us-east-1'})); // Uncomment if S3 is set up

  results.push(await runLoggingLoadTest(iterations, 'console'));
  results.push(
    await runLoggingLoadTest(iterations, 'file', { filename: './test.log' }),
  );

  results.push(await runMeasuringLoadTest(iterations));
  results.push(await runNotifyingLoadTest(iterations));
  results.push(await runQueueingLoadTest(iterations));
  results.push(await runSchedulingLoadTest(iterations));
  results.push(await runSearchingLoadTest(iterations));
  results.push(await runWorkflowLoadTest(iterations / 10)); // Workflow is more intensive
  results.push(await runWorkingLoadTest(iterations));

  console.log('\n--- Load Test Summary ---');
  results.forEach((result) => {
    console.log(
      `Service: ${result.service} (Type: ${result.type || 'N/A'}): ${result.iterations} operations in ${result.duration} ms`,
    );
  });
}

runAllLoadTests().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});
