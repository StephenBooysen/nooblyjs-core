/**
 * @fileoverview Local Working Store for draft file management
 * Handles local file operations for the sync filing provider
 * @author NooblyJS Team
 * @version 1.0.15
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { resolveWithin } = require('../modules/pathSafety');

/**
 * Local working store for managing draft files and user workspace
 */
class LocalWorkingStore {
  /**
   * Creates a new LocalWorkingStore instance
   * @param {string} workingDir - Local directory for user workspace
   * @param {EventEmitter} eventEmitter - Event emitter for notifications
   */
  constructor(workingDir = './workspace', eventEmitter) {
    this.workingDir = path.resolve(workingDir);
    this.eventEmitter_ = eventEmitter;
    this._ensureWorkingDir();
  }

  /**
   * Ensures the working directory exists
   * @private
   */
  async _ensureWorkingDir() {
    try {
      await fs.mkdir(this.workingDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create working directory: ${error.message}`);
      }
    }
  }

  /**
   * Gets the full path for a file, guarding against path traversal.
   * Resolves the requested path against the working directory and verifies
   * the result stays within the working directory boundary. Uses the shared
   * resolveWithin helper (same containment logic as the local filing provider).
   * @param {string} filePath - Relative file path
   * @returns {string} Full file path
   * @throws {Error} If the resolved path escapes the working directory
   */
  _getFullPath(filePath) {
    return resolveWithin(this.workingDir, filePath);
  }

  /**
   * Creates or updates a file in the local working store
   * @param {string} filePath - Relative path to the file
   * @param {Buffer|string} content - File content
   * @returns {Promise<void>}
   */
  async create(filePath, content) {
    const fullPath = this._getFullPath(filePath);
    const dir = path.dirname(fullPath);
    
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
    
    this.eventEmitter_?.emit('file:local:created', { path: filePath, size: Buffer.byteLength(content) });
  }

  /**
   * Reads a file from the local working store
   * @param {string} filePath - Relative path to the file
   * @param {string} [encoding] - File encoding
   * @returns {Promise<Buffer|string>} File content
   */
  async read(filePath, encoding) {
    const fullPath = this._getFullPath(filePath);
    const content = await fs.readFile(fullPath, encoding);
    
    this.eventEmitter_?.emit('file:local:read', { path: filePath });
    return content;
  }

  /**
   * Updates a file in the local working store
   * @param {string} filePath - Relative path to the file
   * @param {Buffer|string} content - New file content
   * @returns {Promise<void>}
   */
  async update(filePath, content) {
    return this.create(filePath, content); // Same operation for local store
  }

  /**
   * Deletes a file from the local working store
   * @param {string} filePath - Relative path to the file
   * @returns {Promise<void>}
   */
  async delete(filePath) {
    const fullPath = this._getFullPath(filePath);
    await fs.unlink(fullPath);
    
    this.eventEmitter_?.emit('file:local:deleted', { path: filePath });
  }

  /**
   * Lists files in a directory in the local working store
   * @param {string} dirPath - Relative directory path
   * @returns {Promise<Array<string>>} Array of file names
   */
  async list(dirPath = '.') {
    const fullPath = this._getFullPath(dirPath);

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      // Return metadata-bearing objects (name/type/size/created/modified),
      // mirroring the local filing provider (providers/filingLocal.js list()).
      // The folder tree and document-header rely on per-entry created/modified
      // timestamps; returning bare filename strings here left synced spaces
      // showing "0 Bytes" / "N/A" in the list/card/grid views.
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
          const entryPath = path.join(fullPath, entry.name);
          // fs.stat follows symlinks; a Dirent reports the link itself, so
          // reclassify symlinks by their target (matches filingLocal).
          const stats = await fs.stat(entryPath);
          if (isSymlink) {
            item.isDirectory = stats.isDirectory();
            item.isFile = stats.isFile();
            item.type = stats.isDirectory() ? 'folder' : 'file';
          }
          item.size = stats.size;
          item.created = stats.birthtime.toISOString();
          item.modified = stats.mtime.toISOString();
        } catch {
          // Broken symlink or stat failure - keep the dirent classification.
        }

        return item;
      }));

      this.eventEmitter_?.emit('file:local:listed', { path: dirPath, count: items.length });
      return items;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Checks if a file exists in the local working store
   * @param {string} filePath - Relative path to the file
   * @returns {Promise<boolean>} True if file exists
   */
  async exists(filePath) {
    const fullPath = this._getFullPath(filePath);
    
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Gets file stats from the local working store
   * @param {string} filePath - Relative path to the file
   * @returns {Promise<fs.Stats>} File statistics
   */
  async stat(filePath) {
    const fullPath = this._getFullPath(filePath);
    return fs.stat(fullPath);
  }

  /**
   * Gets file modification time
   * @param {string} filePath - Relative path to the file
   * @returns {Promise<Date>} Last modification time
   */
  async getModTime(filePath) {
    const stats = await this.stat(filePath);
    return stats.mtime;
  }
}

module.exports = LocalWorkingStore;