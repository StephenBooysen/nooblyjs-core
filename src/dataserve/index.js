/**
 * @fileoverview DataRing service for managing multiple data containers.
 * @fileoverview Factory for creating DataRingService instances.
 */

const InMemoryDataRingProvider = require('./providers/dataserve');
const FileDataRingProvider = require('./providers/dataservefiles');
const SimpleDbDataRingProvider = require('./providers/dataserveSimpleDB');
const Routes = require('./routes');

/**
 * Creates a DataRingService instance based on the provided type.
 * @param {string} type The type of data serving provider to use. Valid options are 'memory', 'file', and 'simpledb'.
 * @param {Object=} options The connection options for the chosen provider.
 * @param {EventEmitter} eventEmitter An event emitter for handling events.
 * @return {!DataRingService} A DataRingService instance.
 */
function createDataserveService(type, options, eventEmitter) {
  let provider;
  switch (type) {
    case 'file':
      provider = new DataServeFileProvider(options, eventEmitter);
      break;
    case 'simpledb':
      provider = new DataServeSimpleDBProvider(options, eventEmitter);
      break;
    default:
      provider = new DataServeProvider(options, eventEmitter);
      break;
  }
  Routes(options, eventEmitter, provider);
  return provider
}
