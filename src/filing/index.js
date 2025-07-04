/**
 * @fileoverview Filing service for abstracting file operations and factory for creating FilingService instances.
 */

const LocalFilingProvider = require('./providers/filingLocal');
const FtpFilingProvider = require('./providers/filingFtp');
const S3FilingProvider = require('./providers/filingS3');

class FilingService {
  constructor(provider, eventEmitter) {
    if (!provider) {
      throw new Error('FilingService requires a provider.');
    }
    this.provider = provider;
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a file with the given content.
   * @param {string} path - The path to the file.
   * @param {string} content - The content of the file.
   * @returns {Promise<void>} A promise that resolves when the file is created.
   */
  async create(path, content) {
    return this.provider.create(path, content);
  }

  /**
   * Reads the content of a file.
   * @param {string} path - The path to the file.
   * @returns {Promise<string>} A promise that resolves with the file content.
   */
  async read(path) {
    return this.provider.read(path);
  }

  /**
   * Deletes a file.
   * @param {string} path - The path to the file.
   * @returns {Promise<void>} A promise that resolves when the file is deleted.
   */
  async delete(path) {
    return this.provider.delete(path);
  }

  /**
   * Lists the contents of a directory.
   * @param {string} path - The path to the directory.
   * @returns {Promise<Array<string>>} A promise that resolves with an array of file/directory names.
   */
  async list(path) {
    return this.provider.list(path);
  }

  /**
   * Updates a file with the given content.
   * @param {string} path - The path to the file.
   * @param {string} content - The new content of the file.
   * @returns {Promise<void>} A promise that resolves when the file is updated.
   */
  async update(path, content) {
    return this.provider.update(path, content);
  }
}

/**
 * Creates a FilingService instance based on the provided type.
 * @param {string} type The type of filing provider to use. Valid options are 'local', 'ftp', and 's3'.
 * @param {Object=} options The connection options for the chosen provider.
 * @return {!FilingService} A FilingService instance.
 */
function createFilingService(type = 'local', options, eventEmitter) {
  let provider;
  switch (type) {
    case 'local':
      provider = new LocalFilingProvider(options, eventEmitter);
      break;
    case 'ftp':
      provider = new FtpFilingProvider(options, eventEmitter);
      break;
    case 's3':
      provider = new S3FilingProvider(options, eventEmitter);
      break;
    default:
      throw new Error(`Unsupported filing provider type: ${type}`);
  }
  return new FilingService(provider, eventEmitter);
}

module.exports = createFilingService;
