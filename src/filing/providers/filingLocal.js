/**
 * @fileoverview Local file system filing provider for file operations
 * on the local file system with event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const fsSync = require('fs');
const path = require('node:path');
const { resolveWithin } = require('../modules/pathSafety');
const {
  applyRuntimeSettings,
  numberRule,
  fileTypesRule
} = require('../modules/settingsPolicy');

/** Library default storage root. Never the working directory (feature 15). */
const DEFAULT_BASE_DIR = './.application/files';

/**
 * Document and image types a user may upload by default. Active content
 * (html, svg, xml, js) is not on the list; see feature 17.
 */
const SAFE_ALLOWED_TYPES = 'md,txt,pdf,png,jpg,jpeg,gif,webp,csv,json,docx,xlsx,pptx';

/** Settings that may change while the service runs. Everything else is fixed. */
const RUNTIME_RULES = {
  maxFileSize: numberRule('maxFileSize', { min: 1, max: 5 * 1024 * 1024 * 1024, integer: true }),
  allowedTypes: fileTypesRule('allowedTypes')
};

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

    // Settings for filing service
    this.settings = {};
    this.settings.description = "Configuration settings for the Filing Service";
    // Only these two settings can change at runtime (see settingsPolicy.js).
    // baseDir is the storage root: it is fixed at construction and never listed.
    this.settings.list = [
      {setting: "maxFileSize", type: "number", values: [10485760]},
      {setting: "allowedTypes", type: "string", values: [SAFE_ALLOWED_TYPES]}
    ];
    this.settings.baseDir = options.baseDir || DEFAULT_BASE_DIR;
    this.settings.maxFileSize = options.maxFileSize || 10485760;
    this.settings.allowedTypes = options.allowedTypes || SAFE_ALLOWED_TYPES;

    /** @private @const {string} Absolute storage root, resolved once. */
    this.rootDir_ = path.resolve(this.settings.baseDir);
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
    const updates = applyRuntimeSettings(settings, {
      rules: RUNTIME_RULES,
      fixed: { baseDir: this.settings.baseDir }
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

module.exports = LocalFilingProvider;
