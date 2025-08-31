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
const GitFilingProvider = require('./providers/filingGit');
const GCPFilingProvider = require('./providers/filingGCP');
const SyncFilingProvider = require('./providers/filingSyncProvider');
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
   * @param {Buffer|ReadableStream|string} content - The file content as Buffer, Stream, or string
   * @return {Promise<void>} Promise that resolves when the file is created
   */
  async create(path, content) {
    return this.provider.create(path, content);
  }

  /**
   * Uploads a file with the given content (alias for create).
   * @param {string} path - The path to the file
   * @param {Buffer|ReadableStream|string} content - The file content as Buffer, Stream, or string
   * @return {Promise<void>} Promise that resolves when the file is uploaded
   */
  async upload(path, content) {
    return this.provider.create(path, content);
  }

  /**
   * Reads the content of a file.
   * @param {string} path - The path to the file
   * @param {string} [encoding] - Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer
   * @return {Promise<Buffer|string>} Promise that resolves with the file content as Buffer or string if encoding specified
   */
  async read(path, encoding) {
    return this.provider.read(path, encoding);
  }

  /**
   * Downloads a file (alias for read).
   * @param {string} path - The path to the file
   * @param {string} [encoding] - Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer
   * @return {Promise<Buffer|string>} Promise that resolves with the file content as Buffer or string if encoding specified
   */
  async download(path, encoding) {
    return this.provider.read(path, encoding);
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
   * @param {Buffer|ReadableStream|string} content - The new file content as Buffer, Stream, or string
   * @return {Promise<void>} Promise that resolves when the file is updated
   */
  async update(path, content) {
    return this.provider.update(path, content);
  }

  // Sync-specific methods (available when using sync provider)
  
  /**
   * Locks a file for exclusive editing (sync provider only)
   * @param {string} path - The path to the file
   * @param {string} [reason] - Lock reason
   * @return {Promise<void>} Promise that resolves when the file is locked
   */
  async lockFile(path, reason) {
    if (this.provider.lockFile) {
      return this.provider.lockFile(path, reason);
    }
    throw new Error('File locking is not supported by this provider');
  }

  /**
   * Unlocks a file (sync provider only)
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is unlocked
   */
  async unlockFile(path) {
    if (this.provider.unlockFile) {
      return this.provider.unlockFile(path);
    }
    throw new Error('File unlocking is not supported by this provider');
  }

  /**
   * Pushes a file to the remote repository (sync provider only)
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is pushed
   */
  async pushFile(path) {
    if (this.provider.pushFile) {
      return this.provider.pushFile(path);
    }
    throw new Error('File pushing is not supported by this provider');
  }

  /**
   * Pulls a file from the remote repository (sync provider only)
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is pulled
   */
  async pullFile(path) {
    if (this.provider.pullFile) {
      return this.provider.pullFile(path);
    }
    throw new Error('File pulling is not supported by this provider');
  }

  /**
   * Synchronizes a specific file (sync provider only)
   * @param {string} path - The path to the file
   * @return {Promise<void>} Promise that resolves when the file is synchronized
   */
  async syncFile(path) {
    if (this.provider.syncFile) {
      return this.provider.syncFile(path);
    }
    throw new Error('File synchronization is not supported by this provider');
  }

  /**
   * Synchronizes all files (sync provider only)
   * @return {Promise<void>} Promise that resolves when all files are synchronized
   */
  async syncAll() {
    if (this.provider.syncAll) {
      return this.provider.syncAll();
    }
    throw new Error('File synchronization is not supported by this provider');
  }

  /**
   * Processes remote change notifications (sync provider only)
   * @param {Array<string>} changedFiles - Array of file paths that changed remotely
   * @return {Promise<void>} Promise that resolves when remote changes are processed
   */
  async processRemoteChanges(changedFiles) {
    if (this.provider.processRemoteChanges) {
      return this.provider.processRemoteChanges(changedFiles);
    }
    throw new Error('Remote change processing is not supported by this provider');
  }

  /**
   * Gets sync status information (sync provider only)
   * @return {Promise<Object>} Promise that resolves with sync status
   */
  async getSyncStatus() {
    if (this.provider.getSyncStatus) {
      return this.provider.getSyncStatus();
    }
    throw new Error('Sync status is not supported by this provider');
  }

  /**
   * Starts automatic synchronization (sync provider only)
   */
  startAutoSync() {
    if (this.provider.startAutoSync) {
      return this.provider.startAutoSync();
    }
    throw new Error('Auto sync is not supported by this provider');
  }

  /**
   * Stops automatic synchronization (sync provider only)
   */
  stopAutoSync() {
    if (this.provider.stopAutoSync) {
      return this.provider.stopAutoSync();
    }
    throw new Error('Auto sync is not supported by this provider');
  }

  // Git-specific methods (available when using Git provider)
  
  /**
   * Commits pending changes with a user-provided message (Git provider only)
   * @param {string} commitId - The pending commit ID
   * @param {string} commitMessage - The commit message
   * @param {string} [userId] - User ID for verification
   * @return {Promise<Object>} Commit result
   */
  async commitWithMessage(commitId, commitMessage, userId) {
    if (this.provider.commitWithMessage) {
      return this.provider.commitWithMessage(commitId, commitMessage, userId);
    }
    throw new Error('Commit with message is not supported by this provider');
  }

  /**
   * Pushes committed changes to remote repository (Git provider only)
   * @return {Promise<Object>} Push result
   */
  async push() {
    if (this.provider.push) {
      return this.provider.push();
    }
    throw new Error('Push is not supported by this provider');
  }

  /**
   * Fetches changes from remote repository (Git provider only)
   * @return {Promise<void>}
   */
  async fetch() {
    if (this.provider.fetch) {
      return this.provider.fetch();
    }
    throw new Error('Fetch is not supported by this provider');
  }

  /**
   * Gets Git repository status (Git provider only)
   * @return {Promise<Object>} Git status information
   */
  async getGitStatus() {
    if (this.provider.getStatus) {
      return this.provider.getStatus();
    }
    throw new Error('Git status is not supported by this provider');
  }

  /**
   * Gets pending commits waiting for messages (Git provider only)
   * @param {string} [userId] - Filter by user ID
   * @return {Array<Object>} Array of pending commits
   */
  getPendingCommits(userId) {
    if (this.provider.getPendingCommits) {
      return this.provider.getPendingCommits(userId);
    }
    throw new Error('Pending commits are not supported by this provider');
  }

  /**
   * Cancels a pending commit (Git provider only)
   * @param {string} commitId - The commit ID to cancel
   * @param {string} [userId] - User ID for verification
   * @return {Promise<void>}
   */
  async cancelCommit(commitId, userId) {
    if (this.provider.cancelCommit) {
      return this.provider.cancelCommit(commitId, userId);
    }
    throw new Error('Cancel commit is not supported by this provider');
  }

  /**
   * Starts automatic fetching from remote (Git provider only)
   */
  startAutoFetch() {
    if (this.provider.startAutoFetch) {
      return this.provider.startAutoFetch();
    }
    throw new Error('Auto fetch is not supported by this provider');
  }

  /**
   * Stops automatic fetching from remote (Git provider only)
   */
  stopAutoFetch() {
    if (this.provider.stopAutoFetch) {
      return this.provider.stopAutoFetch();
    }
    throw new Error('Auto fetch is not supported by this provider');
  }
}

/**
 * Creates a filing service instance with the specified provider.
 * Automatically configures routes and views for the filing service.
 * @param {string} type - The filing provider type ('local', 'ftp', 's3', 'git', 'gcp', 'sync')
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
    case 'git':
      provider = new GitFilingProvider(options, eventEmitter);
      break;
    case 'gcp':
      provider = new GCPFilingProvider(options, eventEmitter);
      break;
    case 'sync':
      // Sync provider requires a remote provider configuration
      if (!options || !options.remoteType) {
        throw new Error('Sync filing provider requires remoteType in options');
      }
      
      // Create the remote provider
      let remoteProvider;
      const remoteOptions = options.remoteOptions || {};
      
      switch (options.remoteType) {
        case 'local':
          remoteProvider = new LocalFilingProvider(remoteOptions, eventEmitter);
          break;
        case 'ftp':
          remoteProvider = new FtpFilingProvider(remoteOptions, eventEmitter);
          break;
        case 's3':
          remoteProvider = new S3FilingProvider(remoteOptions, eventEmitter);
          break;
        case 'git':
          remoteProvider = new GitFilingProvider(remoteOptions, eventEmitter);
          break;
        case 'gcp':
          remoteProvider = new GCPFilingProvider(remoteOptions, eventEmitter);
          break;
        default:
          throw new Error(`Unsupported remote filing provider type: ${options.remoteType}`);
      }
      
      // Create sync provider with remote provider
      const syncOptions = {
        ...options,
        remoteProvider
      };
      provider = new SyncFilingProvider(syncOptions, eventEmitter);
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
