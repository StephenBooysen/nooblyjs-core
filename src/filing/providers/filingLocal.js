/**
 * @fileoverview Local file system filing provider for file operations
 * on the local file system with event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('fs').promises;

/**
 * A class that implements a local file system-based file storage provider.
 * Provides methods for creating, reading, updating, deleting, and listing local files.
 * @class
 */
class LocalFilingProvider {
  /**
   * Initializes the local file system provider.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for file operations.
   */
  constructor(options, eventEmitter) {
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a new file on the local file system.
   * @param {string} filePath The path where the file should be created.
   * @param {string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When file creation fails.
   */
  async create(filePath, content) {
    await fs.writeFile(filePath, content);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:create', { filePath, content });
  }

  /**
   * Reads a file from the local file system.
   * @param {string} filePath The path of the file to read.
   * @return {Promise<string>} A promise that resolves to the file content.
   * @throws {Error} When file reading fails.
   */
  async read(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:read', { filePath, content });
    return content;
  }

  /**
   * Deletes a file from the local file system.
   * @param {string} filePath The path of the file to delete.
   * @return {Promise<void>} A promise that resolves when the file is deleted.
   * @throws {Error} When file deletion fails.
   */
  async delete(filePath) {
    await fs.unlink(filePath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:delete', { filePath });
  }

  /**
   * Lists files in a local directory.
   * @param {string} dirPath The path of the directory to list.
   * @return {Promise<Array<string>>} A promise that resolves to an array of file names.
   * @throws {Error} When directory listing fails.
   */
  async list(dirPath) {
    const files = await fs.readdir(dirPath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:list', { dirPath, files });
    return files;
  }

  /**
   * Updates an existing file on the local file system.
   * @param {string} filePath The path of the file to update.
   * @param {string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When file update fails.
   */
  async update(filePath, content) {
    await fs.writeFile(filePath, content);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:update', { filePath, content });
  }
}

module.exports = LocalFilingProvider;
