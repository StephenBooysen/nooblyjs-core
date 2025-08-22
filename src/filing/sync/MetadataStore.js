/**
 * @fileoverview Metadata Store for sync filing provider
 * Tracks file states, locks, and synchronization information
 * @author NooblyJS Team
 * @version 1.0.15
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * File states in the sync system
 */
const FileStates = {
  DRAFT: 'draft',           // Local only, never synced
  CLEAN: 'clean',           // In sync with remote
  MODIFIED: 'modified',     // Local changes, needs push
  LOCKED_LOCAL: 'locked-local',   // Locked by this user
  LOCKED_REMOTE: 'locked-remote', // Locked by another user
  CONFLICT: 'conflict'      // Both local and remote changed
};

/**
 * Metadata store for managing file sync information
 */
class MetadataStore {
  /**
   * Creates a new MetadataStore instance
   * @param {string} metadataDir - Directory to store metadata
   * @param {string} userId - Current user ID
   * @param {EventEmitter} eventEmitter - Event emitter for notifications
   */
  constructor(metadataDir = './.sync', userId = 'default-user', eventEmitter) {
    this.metadataDir = path.resolve(metadataDir);
    this.metadataFile = path.join(this.metadataDir, 'metadata.json');
    this.userId = userId;
    this.eventEmitter_ = eventEmitter;
    this.metadata = new Map();
    this._initialized = false;
  }

  /**
   * Initializes the metadata store
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    await fs.mkdir(this.metadataDir, { recursive: true });
    await this._loadMetadata();
    this._initialized = true;
  }

  /**
   * Loads metadata from disk
   * @private
   */
  async _loadMetadata() {
    try {
      const data = await fs.readFile(this.metadataFile, 'utf8');
      const metadata = JSON.parse(data);
      this.metadata = new Map(Object.entries(metadata));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to load metadata: ${error.message}`);
      }
      // File doesn't exist yet, start with empty metadata
      this.metadata = new Map();
    }
  }

  /**
   * Saves metadata to disk
   * @private
   */
  async _saveMetadata() {
    const data = Object.fromEntries(this.metadata);
    await fs.writeFile(this.metadataFile, JSON.stringify(data, null, 2));
  }

  /**
   * Gets file metadata
   * @param {string} filePath - File path
   * @returns {Object|null} File metadata or null if not found
   */
  getFileMetadata(filePath) {
    return this.metadata.get(filePath) || null;
  }

  /**
   * Sets file metadata
   * @param {string} filePath - File path
   * @param {Object} metadata - File metadata
   * @returns {Promise<void>}
   */
  async setFileMetadata(filePath, metadata) {
    const currentMeta = this.getFileMetadata(filePath) || {};
    const newMeta = {
      ...currentMeta,
      ...metadata,
      lastModified: new Date().toISOString()
    };
    
    this.metadata.set(filePath, newMeta);
    await this._saveMetadata();
    
    this.eventEmitter_?.emit('metadata:updated', { path: filePath, metadata: newMeta });
  }

  /**
   * Gets file state
   * @param {string} filePath - File path
   * @returns {string} File state
   */
  getFileState(filePath) {
    const metadata = this.getFileMetadata(filePath);
    return metadata?.state || FileStates.DRAFT;
  }

  /**
   * Sets file state
   * @param {string} filePath - File path
   * @param {string} state - File state
   * @returns {Promise<void>}
   */
  async setFileState(filePath, state) {
    await this.setFileMetadata(filePath, { state });
    this.eventEmitter_?.emit('file:state:changed', { path: filePath, state });
  }

  /**
   * Checks if file is locked
   * @param {string} filePath - File path
   * @returns {Object|null} Lock information or null if not locked
   */
  getFileLock(filePath) {
    const metadata = this.getFileMetadata(filePath);
    return metadata?.lock || null;
  }

  /**
   * Locks a file
   * @param {string} filePath - File path
   * @param {string} [userId] - User ID (defaults to current user)
   * @param {string} [reason] - Lock reason
   * @returns {Promise<void>}
   */
  async lockFile(filePath, userId = this.userId, reason = 'Editing') {
    const lockInfo = {
      userId,
      reason,
      timestamp: new Date().toISOString()
    };

    await this.setFileMetadata(filePath, { 
      lock: lockInfo,
      state: userId === this.userId ? FileStates.LOCKED_LOCAL : FileStates.LOCKED_REMOTE
    });
    
    this.eventEmitter_?.emit('file:locked', { path: filePath, lock: lockInfo });
  }

  /**
   * Unlocks a file
   * @param {string} filePath - File path
   * @param {string} [userId] - User ID (defaults to current user)
   * @returns {Promise<void>}
   */
  async unlockFile(filePath, userId = this.userId) {
    const lock = this.getFileLock(filePath);
    
    if (!lock) {
      throw new Error(`File is not locked: ${filePath}`);
    }

    if (lock.userId !== userId && userId === this.userId) {
      throw new Error(`Cannot unlock file locked by another user: ${filePath}`);
    }

    await this.setFileMetadata(filePath, { 
      lock: null,
      state: FileStates.CLEAN // Reset to clean state after unlock
    });
    
    this.eventEmitter_?.emit('file:unlocked', { path: filePath, previousLock: lock });
  }

  /**
   * Checks if file is locked by current user
   * @param {string} filePath - File path
   * @returns {boolean} True if locked by current user
   */
  isLockedByCurrentUser(filePath) {
    const lock = this.getFileLock(filePath);
    return lock && lock.userId === this.userId;
  }

  /**
   * Checks if file is locked by another user
   * @param {string} filePath - File path
   * @returns {boolean} True if locked by another user
   */
  isLockedByOtherUser(filePath) {
    const lock = this.getFileLock(filePath);
    return lock && lock.userId !== this.userId;
  }

  /**
   * Gets files in a specific state
   * @param {string} state - File state to filter by
   * @returns {Array<string>} Array of file paths in the specified state
   */
  getFilesByState(state) {
    const files = [];
    for (const [filePath, metadata] of this.metadata) {
      if (metadata.state === state) {
        files.push(filePath);
      }
    }
    return files;
  }

  /**
   * Gets all locked files
   * @returns {Array<Object>} Array of locked file information
   */
  getLockedFiles() {
    const lockedFiles = [];
    for (const [filePath, metadata] of this.metadata) {
      if (metadata.lock) {
        lockedFiles.push({
          path: filePath,
          lock: metadata.lock,
          state: metadata.state
        });
      }
    }
    return lockedFiles;
  }

  /**
   * Sets remote sync timestamp for a file
   * @param {string} filePath - File path
   * @param {string} timestamp - Remote timestamp
   * @returns {Promise<void>}
   */
  async setRemoteTimestamp(filePath, timestamp) {
    await this.setFileMetadata(filePath, { remoteTimestamp: timestamp });
  }

  /**
   * Gets remote sync timestamp for a file
   * @param {string} filePath - File path
   * @returns {string|null} Remote timestamp or null
   */
  getRemoteTimestamp(filePath) {
    const metadata = this.getFileMetadata(filePath);
    return metadata?.remoteTimestamp || null;
  }

  /**
   * Removes file from metadata
   * @param {string} filePath - File path
   * @returns {Promise<void>}
   */
  async removeFile(filePath) {
    this.metadata.delete(filePath);
    await this._saveMetadata();
    
    this.eventEmitter_?.emit('metadata:removed', { path: filePath });
  }

  /**
   * Gets sync status for all files
   * @returns {Object} Sync status summary
   */
  getSyncStatus() {
    const status = {
      draft: [],
      clean: [],
      modified: [],
      lockedLocal: [],
      lockedRemote: [],
      conflict: [],
      total: this.metadata.size
    };

    for (const [filePath, metadata] of this.metadata) {
      const state = metadata.state || FileStates.DRAFT;
      switch (state) {
        case FileStates.DRAFT:
          status.draft.push(filePath);
          break;
        case FileStates.CLEAN:
          status.clean.push(filePath);
          break;
        case FileStates.MODIFIED:
          status.modified.push(filePath);
          break;
        case FileStates.LOCKED_LOCAL:
          status.lockedLocal.push(filePath);
          break;
        case FileStates.LOCKED_REMOTE:
          status.lockedRemote.push(filePath);
          break;
        case FileStates.CONFLICT:
          status.conflict.push(filePath);
          break;
      }
    }

    return status;
  }
}

module.exports = { MetadataStore, FileStates };