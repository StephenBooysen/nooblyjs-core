const MeasuringService = require('./provider/measuring');
const Routes = require('./routes');

/**
 * Creates a MeasuringService instance.
 * @param {string} type The type of measuring service to create. (Currently only 'default' is supported).
 * @param {Object=} options Options for the measuring service (currently not used).
 * @param {EventEmitter=} eventEmitter Optional EventEmitter instance for event bubbling.
 * @return {!MeasuringService} A MeasuringService instance.
 */
function createMeasuringService(type, options, eventEmitter) {
  const measuring = new MeasuringService(options,eventEmitter);
  Routes(options, eventEmitter, measuring);
  return measuring;
}

module.exports = createMeasuringService;
