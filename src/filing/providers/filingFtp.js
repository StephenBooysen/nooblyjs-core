/**
 * @fileoverview FTP filing provider for remote file operations over FTP protocol
 * with automatic connection management and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Client = require('ftp');

/**
 * A class that implements an FTP-based file storage provider.
 * Provides methods for creating, reading, updating, deleting, and listing files over FTP.
 * @class
 */
class FtpFilingProvider {
  /**
   * Initializes the FTP filing provider with connection settings.
   * @param {Object} options Configuration options for the FTP provider.
   * @param {string} options.connectionString FTP connection string with credentials.
   * @param {EventEmitter=} eventEmitter Optional event emitter for file operations.
   */
  constructor(options, eventEmitter) {
    /** @private @const {string} */
    this.connectionString = options.connectionString;
    /** @private @const {Client} */
    this.client = new Client();
    /** @private {boolean} */
    this.isConnected = false;
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    this.client.on('ready', () => {
      this.isConnected = true;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:connected', {
          connectionString: this.connectionString,
        });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:disconnected', {
          connectionString: this.connectionString,
        });
    });

    this.client.on('error', (err) => {
      console.error('FTP Client Error:', err);
      this.isConnected = false;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:error', {
          connectionString: this.connectionString,
          error: err.message,
        });
    });
  }

  /**
   * Establishes connection to the FTP server.
   * @return {Promise<void>} A promise that resolves when connected.
   * @throws {Error} When FTP connection fails.
   */
  async connect() {
    if (this.isConnected) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.client.connect(this.connectionString);
      this.client.once('ready', () => {
        this.isConnected = true;
        resolve();
      });
      this.client.once('error', reject);
    });
  }

  /**
   * Disconnects from the FTP server.
   * @return {Promise<void>} A promise that resolves when disconnected.
   */
  async disconnect() {
    if (this.isConnected) {
      this.client.end();
    }
  }

  /**
   * Creates a new file on the FTP server.
   * @param {string} filePath The path where the file should be created.
   * @param {string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When file creation fails.
   */
  async create(filePath, content) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.put(Buffer.from(content), filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:create:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:create', { filePath, content });
        resolve();
      });
    });
  }

  /**
   * Reads a file from the FTP server.
   * @param {string} filePath The path of the file to read.
   * @return {Promise<string>} A promise that resolves to the file content.
   * @throws {Error} When file reading fails.
   */
  async read(filePath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      let data = '';
      this.client.get(filePath, (err, stream) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        stream.on('data', (chunk) => (data += chunk.toString()));
        stream.on('end', () => {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read', { filePath, content: data });
          resolve(data);
        });
        stream.on('error', (err) => {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read:error', {
              filePath,
              error: err.message,
            });
          reject(err);
        });
      });
    });
  }

  /**
   * Deletes a file from the FTP server.
   * @param {string} filePath The path of the file to delete.
   * @return {Promise<void>} A promise that resolves when the file is deleted.
   * @throws {Error} When file deletion fails.
   */
  async delete(filePath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.delete(filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:delete:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:delete', { filePath });
        resolve();
      });
    });
  }

  /**
   * Lists files in a directory on the FTP server.
   * @param {string} dirPath The path of the directory to list.
   * @return {Promise<Array<string>>} A promise that resolves to an array of file names.
   * @throws {Error} When directory listing fails.
   */
  async list(dirPath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.list(dirPath, (err, list) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:list:error', {
              dirPath,
              error: err.message,
            });
          return reject(err);
        }
        const files = list.map((item) => item.name);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:list', { dirPath, files });
        resolve(files);
      });
    });
  }

  /**
   * Updates an existing file on the FTP server.
   * @param {string} filePath The path of the file to update.
   * @param {string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When file update fails.
   */
  async update(filePath, content) {
    // For FTP, update is essentially create (put) as it overwrites if exists
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.put(Buffer.from(content), filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:update:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:update', { filePath, content });
        resolve();
      });
    });
  }
}

module.exports = FtpFilingProvider;
