/**
 * @fileoverview Local file system filing provider for file operations
 * on the local file system with event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { applySettings, SAFE_ALLOWED_TYPES } = require('../modules/settingsGuard');

const fs = require('node:fs').promises;
const fsSync = require('fs');
const path = require('node:path');
const { resolveWithin } = require('../modules/pathSafety');
const { registerFilingRoot } = require('../../working/modules/activityPath');

/** Default storage root: never the application directory itself. */
const DEFAULT_BASE_DIR = './.application/files';

/**
 * A class that implements a local file system-based file storage provider.
 * Provides methods for creating, reading, updating, deleting, and listing local files.
 * @class
 */
class LocalFilingProvider {
  /**
   * Initializes the local file system provider.
   * @param {Object=} options Configuration options: `baseDir` (fixed for the
   *     life of the provider; default ./.application/files), `maxFileSize`,
   *     `allowedTypes` (default: a safe document and image list).
   * @param {EventEmitter=} eventEmitter Optional event emitter for file operations.
   */
  constructor(options, eventEmitter) {
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Settings for filing service
    this.settings = {};
    this.settings.description = "Configuration settings for the Filing Service";
    // baseDir is not in the editable list: the storage root is fixed at
    // construction (feature 15). It stays on `settings` for display only.
    this.settings.list = [
      {setting: "maxFileSize", type: "number", values: [10485760]},
      {setting: "allowedTypes", type: "string", values: [SAFE_ALLOWED_TYPES]}
    ];
    options = options || {};
    this.settings.baseDir = options.baseDir || DEFAULT_BASE_DIR;
    this.settings.maxFileSize = options.maxFileSize || 10485760;
    this.settings.allowedTypes = options.allowedTypes || SAFE_ALLOWED_TYPES;

    /**
     * The resolved storage root. Set once here and used for every path check,
     * so nothing that changes `settings` at runtime can move the store.
     * @private @const {string}
     */
    this.rootDir_ = path.resolve(this.settings.baseDir);
    Object.defineProperty(this, 'rootDir_', { writable: false, configurable: false });

    // Feature 18: nothing in a filing store may ever run as an activity, and a
    // store must not overlap a working activities folder.
    registerFilingRoot(this.rootDir_);
  }

  /**
   * Resolves a file path and verifies it stays within the base directory.
   * @param {string} filePath The file path to resolve (empty string refers to baseDir).
   * @return {string} The resolved absolute file path.
   * @throws {Error} When the path is outside the base directory or invalid.
   * @private
   */
  _resolveAndVerifyPath(filePath) {
    const baseDir = this.rootDir_;
    try {
      // resolveWithin fixes the prefix-bypass of the previous
      // startsWith(baseDir) check (e.g. /srv/data vs /srv/data-secrets).
      return resolveWithin(baseDir, filePath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:security-error', {
          error: error.message,
          filePath,
          baseDir
        });
      }
      throw error;
    }
  }

  /**
   * Creates a new file on the local file system.
   * @param {string} filePath The path where the file should be created.
   * @param {Buffer|ReadableStream|string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When filePath or content is invalid, or file creation fails.
   */
  async create(filePath, content) {
    try {
      filePath = this._resolveAndVerifyPath(filePath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'create',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

    // Validate content parameter
    if (content === undefined || content === null) {
      const error = new Error('Invalid content: cannot be null or undefined');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'create',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

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
   * @throws {Error} When filePath is invalid or file reading fails.
   */
  async read(filePath, encoding) {
    try {
      filePath = this._resolveAndVerifyPath(filePath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'read',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

    // Validate encoding parameter if provided
    if (encoding !== undefined && typeof encoding !== 'string') {
      const error = new Error('Invalid encoding: must be a string if provided');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'read',
          error: error.message,
          filePath,
          encoding
        });
      }
      throw error;
    }

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
   * @throws {Error} When filePath is invalid or file deletion fails.
   */
  async delete(filePath) {
    try {
      filePath = this._resolveAndVerifyPath(filePath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'delete',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

    await fs.unlink(filePath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:delete', { filePath });
  }

  /**
   * Lists files in a local directory.
   * @param {string} dirPath The path of the directory to list.
   * @return {Promise<Array<string>>} A promise that resolves to an array of file names.
   * @throws {Error} When dirPath is invalid or directory listing fails.
   */
  async list(dirPath) {
    try {
      dirPath = this._resolveAndVerifyPath(dirPath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'list',
          error: error.message,
          dirPath
        });
      }
      throw error;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Transform entries to include type information and metadata
    const items = await Promise.all(entries.map(async entry => {
      const isSymlink = entry.isSymbolicLink();
      const item = {
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: isSymlink
      };

      try {
        const fullPath = path.join(dirPath, entry.name);
        // fs.stat (unlike lstat) follows symlinks, so for a link this resolves
        // the target. A Dirent reports the link entry itself, so symlinks always
        // arrive as neither file nor directory — reclassify them by their target.
        const stats = await fs.stat(fullPath);
        if (isSymlink) {
          item.isDirectory = stats.isDirectory();
          item.isFile = stats.isFile();
          item.type = stats.isDirectory() ? 'folder' : 'file';
        }
        item.size = stats.size;
        item.created = stats.birthtime.toISOString();
        item.modified = stats.mtime.toISOString();
      } catch {
        // Broken symlink or stat failure - keep the link-entry classification
      }

      return item;
    }));

    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:list', { dirPath, items });
    return items;
  }

  /**
   * Updates an existing file on the local file system.
   * @param {string} filePath The path of the file to update.
   * @param {Buffer|ReadableStream|string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When filePath or content is invalid, or file update fails.
   */
  async update(filePath, content) {
    try {
      filePath = this._resolveAndVerifyPath(filePath);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'update',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

    // Validate content parameter
    if (content === undefined || content === null) {
      const error = new Error('Invalid content: cannot be null or undefined');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:validation-error', {
          method: 'update',
          error: error.message,
          filePath
        });
      }
      throw error;
    }

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
    // Feature 15: only listed operational settings change at runtime; the
    // storage identity (root, bucket, remote) is fixed at construction.
    return applySettings(this, settings, this.logger);
  }
}

module.exports = LocalFilingProvider;
