/**
 * @fileoverview DataRing service for managing multiple data containers.
 * @fileoverview Factory for creating DataRingService instances.
 */

const InMemoryDataRingProvider = require('./providers/dataserveInMemory');
const FileDataRingProvider = require('./providers/dataserveFile');
const SimpleDbDataRingProvider = require('./providers/dataserveSimpleDb');
class DataServeService {
  constructor(provider, eventEmitter) {
    if (!provider) {
      throw new Error('DataRingService requires a provider.');
    }
    this.provider = provider;
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a new data container.
   * @param {string} containerName - The name of the container.
   * @returns {Promise<void>} A promise that resolves when the container is created.
   */
  async createContainer(containerName) {
    return this.provider.createContainer(containerName);
  }

  /**
   * Adds a JSON object to a specified container.
   * @param {string} containerName - The name of the container.
   * @param {object} jsonObject - The JSON object to add.
   * @returns {Promise<string>} A promise that resolves with the unique key of the added object.
   */
  async add(containerName, jsonObject) {
    return this.provider.add(containerName, jsonObject);
  }

  /**
   * Removes a JSON object from a specified container by its key.
   * @param {string} containerName - The name of the container.
   * @param {string} objectKey - The key of the JSON object to remove.
   * @returns {Promise<boolean>} A promise that resolves to true if the object was removed, false otherwise.
   */
  async remove(containerName, objectKey) {
    return this.provider.remove(containerName, objectKey);
  }

  /**
   * Finds JSON objects in a specified container that contain the search term.
   * @param {string} containerName - The name of the container.
   * @param {string} searchTerm - The term to search for.
   * @returns {Promise<Array<object>>} A promise that resolves with an array of matching JSON objects.
   */
  async find(containerName, searchTerm) {
    return this.provider.find(containerName, searchTerm);
  }
}

/**
 * Creates a DataRingService instance based on the provided type.
 * @param {string} type The type of data ring provider to use. Valid options are 'memory', 'file', and 'simpledb'.
 * @param {Object=} options The connection options for the chosen provider.
 * @return {!DataRingService} A DataRingService instance.
 */
function createDataserveService(type, options, eventEmitter) {
  let provider;
  switch (type) {
    case 'memory':
      provider = new InMemoryDataRingProvider(options, eventEmitter);
      break;
    case 'file':
      provider = new FileDataRingProvider(options, eventEmitter);
      break;
    case 'simpledb':
      provider = new SimpleDbDataRingProvider(options, eventEmitter);
      break;
    default:
      throw new Error(`Unsupported data ring provider type: ${type}`);
  }
  return new DataServeService(provider, eventEmitter);
}
module.exports = createDataserveService;