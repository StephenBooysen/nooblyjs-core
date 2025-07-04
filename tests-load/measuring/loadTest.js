const createMeasuringService = require('../../src/measuring');
const EventEmitter = require('events');

async function runMeasuringLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const measuringService = createMeasuringService('default', {}, eventEmitter);

  const startTime = Date.now();
  console.log(`Starting Measuring Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    measuringService.add('testMetric', Math.random() * 100);
    if (i % 1000 === 0) {
      // console.log(`Measuring iteration ${i}`);
    }
  }
  measuringService.total('testMetric', new Date(0), new Date());
  measuringService.average('testMetric', new Date(0), new Date());

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Measuring Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'measuring', iterations, duration };
}

module.exports = runMeasuringLoadTest;
