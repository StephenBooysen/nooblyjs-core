/**
 * @fileoverview Local file system filing provider for file operations
 * on the local file system with event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

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
   * @param {Buffer|ReadableStream|string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When file creation fails.
   */
  async create(filePath, content) {
    await this._ensureDirectoryExists(filePath);

    if (content && typeof content.pipe === 'function') {
      // Handle ReadableStream
      await this._writeStreamToFile(filePath, content);
    } else {
      // Handle Buffer or string
      await fs.writeFile(filePath, content);
    }

    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:create', {
        filePath,
        contentType: typeof content,
      });
  }

  /**
   * Reads a file from the local file system.
   * @param {string} filePath The path of the file to read.
   * @param {string} [encoding] Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer.
   * @return {Promise<Buffer|string>} A promise that resolves to the file content.
   * @throws {Error} When file reading fails.
   */
  async read(filePath, encoding) {
    const content = encoding
      ? await fs.readFile(filePath, encoding)
      : await fs.readFile(filePath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:read', {
        filePath,
        encoding,
        contentType: encoding ? 'string' : 'Buffer',
      });
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
   * @param {Buffer|ReadableStream|string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When file update fails.
   */
  async update(filePath, content) {
    await this._ensureDirectoryExists(filePath);

    if (content && typeof content.pipe === 'function') {
      // Handle ReadableStream
      await this._writeStreamToFile(filePath, content);
    } else {
      // Handle Buffer or string
      await fs.writeFile(filePath, content);
    }

    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:update', {
        filePath,
        contentType: typeof content,
      });
  }
  /**
   * Ensures the directory for the given file path exists.
   * @param {string} filePath The file path to ensure directory exists for.
   * @return {Promise<void>} A promise that resolves when directory is ensured.
   * @private
   */
  async _ensureDirectoryExists(filePath) {
    const dirname = path.dirname(filePath);
    try {
      await fs.access(dirname);
    } catch (error) {
      await fs.mkdir(dirname, { recursive: true });
    }
  }

  /**
   * Writes a readable stream to a file.
   * @param {string} filePath The path where to write the file.
   * @param {ReadableStream} stream The readable stream to write.
   * @return {Promise<void>} A promise that resolves when the stream is written.
   * @private
   */
  async _writeStreamToFile(filePath, stream) {
    return new Promise((resolve, reject) => {
      const writeStream = fsSync.createWriteStream(filePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      stream.on('error', reject);
    });
  }
}

module.exports = LocalFilingProvider;
