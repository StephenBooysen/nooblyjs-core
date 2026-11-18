/**
 * @fileoverview Sync Filing Provider with draft management and file locking
 * Provides bidirectional sync between local working store and remote repository
 * @author NooblyJS Team
 * @version 1.0.15
 */

'use strict';

const LocalWorkingStore = require('../sync/LocalWorkingStore');
const { MetadataStore, FileStates } = require('../sync/MetadataStore');

/**
 * Sync filing provider that manages local drafts and remote synchronization
 */
class SyncFilingProvider {
  /**
   * Creates a new SyncFilingProvider instance
   * @param {Object} options - Configuration options
   * @param {Object} options.remoteProvider - Remote filing provider instance
   * @param {string} [options.workingDir] - Local working directory
   * @param {string} [options.metadataDir] - Metadata directory
   * @param {string} [options.userId] - Current user ID
   * @param {number} [options.syncInterval] - Auto-sync interval in milliseconds
   * @param {EventEmitter} eventEmitter - Global event emitter
   */
  constructor(options, eventEmitter) {
    if (!options || !options.remoteProvider) {
      throw new Error('SyncFilingProvider requires a remoteProvider option');
    }

    this.remoteProvider = options.remoteProvider;
    this.eventEmitter_ = eventEmitter;
    
    this.localStore = new LocalWorkingStore(
      options.workingDir || './workspace',
      eventEmitter
    );
    
    this.metadata = new MetadataStore(
      options.metadataDir || './.sync',
      options.userId || 'default-user',
      eventEmitter
    );
    
    this.syncInterval = options.syncInterval || 30000; // 30 seconds default
    this.autoSyncEnabled = options.autoSync !== false;
    this._syncTimer = null;
    this._initialized = false;
  }

  /**
   * Initializes the sync provider
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    await this.metadata.initialize();
    
    if (this.autoSyncEnabled) {
      this.startAutoSync();
    }
    
    this._initialized = true;
    this.eventEmitter_?.emit('sync:initialized', { userId: this.metadata.userId });
  }

  /**
   * Starts automatic synchronization
   */
  startAutoSync() {
    if (this._syncTimer) return;
    
    this._syncTimer = setInterval(async () => {
      try {
        await this.syncAll();
      } catch (error) {
        this.eventEmitter_?.emit('sync:error', { error: error.message });
      }
    }, this.syncInterval);
    
    this.eventEmitter_?.emit('sync:auto-started', { interval: this.syncInterval });
  }

  /**
   * Stops automatic synchronization
   */
  stopAutoSync() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
      this.eventEmitter_?.emit('sync:auto-stopped');
    }
  }

  /**
   * Creates a file in the local working store (draft mode)
   * @param {string} filePath - Path to the file
   * @param {Buffer|string} content - File content
   * @returns {Promise<void>}
   */
  async create(filePath, content) {
    await this._ensureInitialized();
    
    // Check if file is locked by another user
    if (this.metadata.isLockedByOtherUser(filePath)) {
      throw new Error(`File is locked by another user: ${filePath}`);
    }
    
    await this.localStore.create(filePath, content);
    await this.metadata.setFileState(filePath, FileStates.DRAFT);
    
    this.eventEmitter_?.emit('file:created', { path: filePath, state: 'draft' });
  }

  /**
   * Reads a file from the local working store
   * @param {string} filePath - Path to the file
   * @param {string} [encoding] - File encoding
   * @returns {Promise<Buffer|string>} File content
   */
  async read(filePath, encoding) {
    await this._ensureInitialized();
    
    // Try local store first
    if (await this.localStore.exists(filePath)) {
      return this.localStore.read(filePath, encoding);
    }
    
    // If not in local store, sync from remote
    await this.pullFile(filePath);
    return this.localStore.read(filePath, encoding);
  }

  /**
   * Updates a file in the local working store
   * @param {string} filePath - Path to the file
   * @param {Buffer|string} content - New file content
   * @returns {Promise<void>}
   */
  async update(filePath, content) {
    await this._ensureInitialized();
    
    // Check if file is locked by another user
    if (this.metadata.isLockedByOtherUser(filePath)) {
      throw new Error(`File is locked by another user: ${filePath}`);
    }
    
    await this.localStore.update(filePath, content);
    
    const currentState = this.metadata.getFileState(filePath);
    if (currentState !== FileStates.DRAFT && currentState !== FileStates.LOCKED_LOCAL) {
      await this.metadata.setFileState(filePath, FileStates.MODIFIED);
    }
    
    this.eventEmitter_?.emit('file:updated', { path: filePath });
  }

  /**
   * Deletes a file from the local working store
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async delete(filePath) {
    await this._ensureInitialized();
    
    // Check if file is locked by another user
    if (this.metadata.isLockedByOtherUser(filePath)) {
      throw new Error(`File is locked by another user: ${filePath}`);
    }
    
    await this.localStore.delete(filePath);
    await this.metadata.removeFile(filePath);
    
    this.eventEmitter_?.emit('file:deleted', { path: filePath });
  }

  /**
   * Lists files in the local working store
   * @param {string} dirPath - Directory path
   * @returns {Promise<Array<string>>} Array of file names
   */
  async list(dirPath = '.') {
    await this._ensureInitialized();
    return this.localStore.list(dirPath);
  }

  /**
   * Locks a file for exclusive editing
   * @param {string} filePath - Path to the file
   * @param {string} [reason] - Lock reason
   * @returns {Promise<void>}
   */
  async lockFile(filePath, reason = 'Editing') {
    await this._ensureInitialized();
    
    // Check if already locked by another user
    if (this.metadata.isLockedByOtherUser(filePath)) {
      const lock = this.metadata.getFileLock(filePath);
      throw new Error(`File is already locked by ${lock.userId}: ${filePath}`);
    }
    
    await this.metadata.lockFile(filePath, this.metadata.userId, reason);
    
    // Try to propagate lock to remote if possible
    try {
      if (this.remoteProvider.lockFile) {
        await this.remoteProvider.lockFile(filePath, this.metadata.userId, reason);
      }
    } catch (error) {
      // Remote lock failed, but keep local lock
      this.eventEmitter_?.emit('sync:remote-lock-failed', { path: filePath, error: error.message });
    }
  }

  /**
   * Unlocks a file
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async unlockFile(filePath) {
    await this._ensureInitialized();
    
    await this.metadata.unlockFile(filePath, this.metadata.userId);
    
    // Try to remove remote lock if possible
    try {
      if (this.remoteProvider.unlockFile) {
        await this.remoteProvider.unlockFile(filePath, this.metadata.userId);
      }
    } catch (error) {
      // Remote unlock failed, but local unlock succeeded
      this.eventEmitter_?.emit('sync:remote-unlock-failed', { path: filePath, error: error.message });
    }
  }

  /**
   * Pushes a file to the remote repository
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async pushFile(filePath) {
    await this._ensureInitialized();
    
    const state = this.metadata.getFileState(filePath);
    
    if (state === FileStates.LOCKED_REMOTE) {
      throw new Error(`Cannot push file locked by another user: ${filePath}`);
    }
    
    if (!await this.localStore.exists(filePath)) {
      throw new Error(`File does not exist in local store: ${filePath}`);
    }
    
    const content = await this.localStore.read(filePath);
    await this.remoteProvider.create(filePath, content);
    
    // Update metadata
    const remoteTimestamp = new Date().toISOString();
    await this.metadata.setRemoteTimestamp(filePath, remoteTimestamp);
    await this.metadata.setFileState(filePath, FileStates.CLEAN);
    
    this.eventEmitter_?.emit('file:pushed', { path: filePath, timestamp: remoteTimestamp });
  }

  /**
   * Pulls a file from the remote repository
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async pullFile(filePath) {
    await this._ensureInitialized();
    
    if (this.metadata.isLockedByCurrentUser(filePath)) {
      throw new Error(`Cannot pull file locked locally: ${filePath}`);
    }
    
    try {
      const content = await this.remoteProvider.read(filePath);
      await this.localStore.create(filePath, content);
      
      const remoteTimestamp = new Date().toISOString();
      await this.metadata.setRemoteTimestamp(filePath, remoteTimestamp);
      await this.metadata.setFileState(filePath, FileStates.CLEAN);
      
      this.eventEmitter_?.emit('file:pulled', { path: filePath, timestamp: remoteTimestamp });
    } catch (error) {
      // File might not exist in remote yet
      if (error.message.includes('not found') || error.message.includes('ENOENT')) {
        this.eventEmitter_?.emit('file:not-found-remote', { path: filePath });
      } else {
        throw error;
      }
    }
  }

  /**
   * Synchronizes a specific file
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async syncFile(filePath) {
    await this._ensureInitialized();
    
    const state = this.metadata.getFileState(filePath);
    
    switch (state) {
      case FileStates.DRAFT:
        // Don't auto-sync drafts
        break;
        
      case FileStates.MODIFIED:
        if (!this.metadata.isLockedByOtherUser(filePath)) {
          await this.pushFile(filePath);
        }
        break;
        
      case FileStates.CLEAN:
        // Check if remote has changed
        await this.pullFile(filePath);
        break;
        
      case FileStates.LOCKED_LOCAL:
      case FileStates.LOCKED_REMOTE:
        // Don't sync locked files
        break;
        
      case FileStates.CONFLICT:
        // Conflicts need manual resolution
        this.eventEmitter_?.emit('sync:conflict', { path: filePath });
        break;
    }
  }

  /**
   * Synchronizes all files
   * @returns {Promise<void>}
   */
  async syncAll() {
    await this._ensureInitialized();
    
    const status = this.metadata.getSyncStatus();
    const allFiles = [...status.clean, ...status.modified];
    
    for (const filePath of allFiles) {
      try {
        await this.syncFile(filePath);
      } catch (error) {
        this.eventEmitter_?.emit('sync:file-error', { path: filePath, error: error.message });
      }
    }
    
    this.eventEmitter_?.emit('sync:completed', { 
      filesProcessed: allFiles.length,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Processes remote change notifications
   * @param {Array<string>} changedFiles - Array of file paths that changed remotely
   * @returns {Promise<void>}
   */
  async processRemoteChanges(changedFiles) {
    await this._ensureInitialized();
    
    for (const filePath of changedFiles) {
      try {
        if (!this.metadata.isLockedByCurrentUser(filePath)) {
          await this.pullFile(filePath);
        } else {
          // Mark as conflict if locally locked but remote changed
          await this.metadata.setFileState(filePath, FileStates.CONFLICT);
        }
      } catch (error) {
        this.eventEmitter_?.emit('sync:remote-change-error', { path: filePath, error: error.message });
      }
    }
    
    this.eventEmitter_?.emit('sync:remote-changes-processed', { 
      files: changedFiles,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Gets sync status for all files
   * @returns {Object} Sync status information
   */
  async getSyncStatus() {
    await this._ensureInitialized();
    
    return {
      ...this.metadata.getSyncStatus(),
      autoSyncEnabled: this.autoSyncEnabled,
      syncInterval: this.syncInterval,
      userId: this.metadata.userId
    };
  }

  /**
   * Ensures the provider is initialized
   * @private
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.initialize();
    }
  }
}

module.exports = SyncFilingProvider;