/**
 * @fileoverview Filing Service Factory
 * Factory module for creating file service instances with multiple provider support.
 * Supports local filesystem, FTP, and S3 backends with routing and views.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const LocalFilingProvider = require('./providers/filingLocal');
const FtpFilingProvider = require('./providers/filingFtp');
const S3FilingProvider = require('./providers/filingS3');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Filing service wrapper class that provides a unified interface for file operations.
 * Abstracts the underlying provider implementation and provides common file operations.
 */
class FilingService {
  /**
   * Creates a new FilingService instance.
   * @param {Object} provider - The filing provider implementation (local, ftp, s3)
   * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
   * @throws {Error} When provider is not provided
   */
  constructor(provider, eventEmitter) {
    if (!provider) {
      throw new Error('FilingService requires a provider.');
    }
    this.provider = provider;
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a file with the given content.
   * @param {string} path - The path to the file
   * @param {string} content - The content of the file
   * @return {Promise<void>} Promise that resolves when the file is created
   */
  async create(path, content) {
    return this.provider.create(path, content);
  }

  /**
   * Uploads a file with the given content (alias for create).
   * @param {string} path - The path to the file
   * @param {string} content - The content of the file
   * @return {Promise<void>} Promise that resolves when the file is uploaded
   */
  async upload(path, content) {
    return this.provider.create(path, content);
  }

  /**
   * Reads the content of a file.
   * @param {string} path - The path to the file
   * @return {Promise<string>} Promise that resolves with the file content
   */
  async read(path) {
    return this.provider.read(path);
  }

  /**
   * Downloads a file (alias for read).
   * @param {string} path - The path to the file
   * @return {Promise<string>} Promise that resolves with the file content
   */
  async download(path) {
    return this.provider.read(path);
  }

  /**
   * Deletes a file.
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is deleted
   */
  async delete(path) {
    return this.provider.delete(path);
  }

  /**
   * Removes a file (alias for delete).
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is removed
   */
  async remove(path) {
    return this.provider.delete(path);
  }

  /**
   * Lists the contents of a directory.
   * @param {string} path - The path to the directory
   * @return {Promise<Array<string>>} Promise that resolves with an array of file/directory names
   */
  async list(path) {
    return this.provider.list(path);
  }

  /**
   * Updates a file with the given content.
   * @param {string} path - The path to the file
   * @param {string} content - The new content of the file
   * @return {Promise<void>} Promise that resolves when the file is updated
   */
  async update(path, content) {
    return this.provider.update(path, content);
  }
}

/**
 * Creates a filing service instance with the specified provider.
 * Automatically configures routes and views for the filing service.
 * @param {string} type - The filing provider type ('local', 'ftp', 's3')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {FilingService} Filing service instance with specified provider
 * @throws {Error} When unsupported filing provider type is provided
 */
function createFilingService(type = 'local', options, eventEmitter) {
  let provider;

  // Create filing provider instance based on type
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

  // Create service instance with the selected provider
  const service = new FilingService(provider, eventEmitter);

  // Initialize routes and views for the filing service
  Routes(options, eventEmitter, service);
  Views(options, eventEmitter, service);

  return service;
}

module.exports = createFilingService;
