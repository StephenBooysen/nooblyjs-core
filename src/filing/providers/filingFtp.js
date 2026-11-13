/**
 * @fileoverview FTP filing provider for remote file operations over FTP protocol
 * with automatic connection management and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Client = require('ftp');
const { assertSafeRelativePath } = require('../modules/pathSafety');
const { applyRuntimeSettings, numberRule } = require('../modules/settingsPolicy');

/** Settings that may change while the service runs. The server address is fixed. */
const RUNTIME_RULES = {
  timeout: numberRule('timeout', { min: 1000, max: 600000, integer: true }),
  retryLimit: numberRule('retryLimit', { min: 0, max: 10, integer: true }),
  maxUploadSize: numberRule('maxUploadSize', { min: 1, max: 5 * 1024 * 1024 * 1024, integer: true })
};


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
      this.logger?.error(`[${this.constructor.name}] FTP Client Error`, {
        error: err.message,
        stack: err.stack,
        connectionString: this.connectionString
      });
      this.isConnected = false;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:error', {
          connectionString: this.connectionString,
          error: err.message,
        });
    });

    // Settings for filing FTP provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Filing FTP Provider";
    this.settings.list = [
      {setting: "timeout", type: "number", values: [30000]},
      {setting: "retryLimit", type: "number", values: [3]},
      {setting: "maxUploadSize", type: "number", values: [104857600]}
    ];
    this.settings.timeout = options.timeout || this.settings.list[0].values[0];
    this.settings.retryLimit = options.retryLimit || this.settings.list[1].values[0];
    this.settings.maxUploadSize = options.maxUploadSize || this.settings.list[2].values[0];
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
   * Helper to wrap FTP operations with automatic connection management.
   * @param {Function} operation The operation to perform.
   * @return {Promise<*>} The result of the operation.
   * @private
   */
  async _withConnection(operation) {
    const wasConnected = this.isConnected;
    await this.connect();
    try {
      return await operation();
    } finally {
      // Only disconnect if we weren't connected before this operation
      // and we want to prevent long-running idle connections.
      // For production readiness, we'll disconnect after each op if it wasn't pre-connected.
      if (!wasConnected) {
        await this.disconnect();
      }
    }
  }

  /**
   * Creates a new file on the FTP server.
   * @param {string} filePath The path where the file should be created.
   * @param {Buffer|ReadableStream|string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When file creation fails.
   */
  async create(filePath, content) {
    assertSafeRelativePath(filePath);
    return this._withConnection(() => {
      return new Promise((resolve, reject) => {
        let dataToUpload;

        if (content && typeof content.pipe === 'function') {
          // Handle ReadableStream
          dataToUpload = content;
        } else if (Buffer.isBuffer(content)) {
          // Handle Buffer
          dataToUpload = content;
        } else {
          // Handle string
          dataToUpload = Buffer.from(content);
        }

        this.client.put(dataToUpload, filePath, (err) => {
          if (err) {
            if (this.eventEmitter_)
              this.eventEmitter_.emit('filing:create:error', {
                filePath,
                error: err.message,
              });
            return reject(err);
          }
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:create', {
              filePath,
              contentType: typeof content,
            });
          resolve();
        });
      });
    });
  }

  /**
   * Reads a file from the FTP server.
   * @param {string} filePath The path of the file to read.
   * @param {string} [encoding] Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer.
   * @return {Promise<Buffer|string>} A promise that resolves to the file content.
   * @throws {Error} When file reading fails.
   */
  async read(filePath, encoding) {
    assertSafeRelativePath(filePath);
    return this._withConnection(() => {
      return new Promise((resolve, reject) => {
        const chunks = [];
        this.client.get(filePath, (err, stream) => {
          if (err) {
            if (this.eventEmitter_)
              this.eventEmitter_.emit('filing:read:error', {
                filePath,
                error: err.message,
              });
            return reject(err);
          }
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const content = encoding ? buffer.toString(encoding) : buffer;
            if (this.eventEmitter_)
              this.eventEmitter_.emit('filing:read', {
                filePath,
                encoding,
                contentType: encoding ? 'string' : 'Buffer',
              });
            resolve(content);
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
    });
  }

  /**
   * Deletes a file from the FTP server.
   * @param {string} filePath The path of the file to delete.
   * @return {Promise<void>} A promise that resolves when the file is deleted.
   * @throws {Error} When file deletion fails.
   */
  async delete(filePath) {
    assertSafeRelativePath(filePath);
    return this._withConnection(() => {
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
    });
  }

  /**
   * Lists files in a directory on the FTP server.
   * @param {string} dirPath The path of the directory to list.
   * @return {Promise<Array<string>>} A promise that resolves to an array of file names.
   * @throws {Error} When directory listing fails.
   */
  async list(dirPath) {
    assertSafeRelativePath(dirPath);
    return this._withConnection(() => {
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
    });
  }

  /**
   * Updates an existing file on the FTP server.
   * @param {string} filePath The path of the file to update.
   * @param {Buffer|ReadableStream|string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When file update fails.
   */
  async update(filePath, content) {
    assertSafeRelativePath(filePath);
    return this._withConnection(() => {
      return new Promise((resolve, reject) => {
        let dataToUpload;

        if (content && typeof content.pipe === 'function') {
          // Handle ReadableStream
          dataToUpload = content;
        } else if (Buffer.isBuffer(content)) {
          // Handle Buffer
          dataToUpload = content;
        } else {
          // Handle string
          dataToUpload = Buffer.from(content);
        }

        this.client.put(dataToUpload, filePath, (err) => {
          if (err) {
            if (this.eventEmitter_)
              this.eventEmitter_.emit('filing:update:error', {
                filePath,
                error: err.message,
              });
            return reject(err);
          }
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:update', {
              filePath,
              contentType: typeof content,
            });
          resolve();
        });
      });
    });
  }

  /**
   * Get all settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Save/update settings
   */
  async saveSettings(settings){
    const updates = applyRuntimeSettings(settings, {
      rules: RUNTIME_RULES,
      fixed: {}
    });
    for (const [setting, newValue] of Object.entries(updates)) {
      this.settings[setting] = newValue;
      this.logger?.info(`[${this.constructor.name}] Setting changed`, {
        setting,
        newValue,
        operation: 'saveSettings'
      });
    }
  }
}

module.exports = FtpFilingProvider;
