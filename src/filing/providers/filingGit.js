/**
 * @fileoverview Git Filing Provider with automated fetch and manual commit
 * Provides Git-backed file storage with commit message requirements and conflict resolution
 * @author NooblyJS Team  
 * @version 1.0.15
 */

'use strict';

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const CommitQueue = require('../sync/CommitQueue');

/**
 * Git filing provider that manages files in a Git repository
 * Features automatic fetching, manual commits, and "latest wins" conflict resolution
 */
class GitFilingProvider {
  /**
   * Creates a new GitFilingProvider instance
   * @param {Object} options - Configuration options
   * @param {string} options.repoUrl - Git repository URL
   * @param {string} [options.localPath] - Local path for Git repository
   * @param {string} [options.branch] - Git branch to work with (default: main)
   * @param {string} [options.userId] - User ID for commits  
   * @param {string} [options.userEmail] - User email for commits
   * @param {string} [options.userName] - User name for commits
   * @param {Object} [options.auth] - Authentication options
   * @param {string} [options.auth.token] - GitHub token or password
   * @param {string} [options.auth.username] - Username for authentication
   * @param {number} [options.fetchInterval] - Auto-fetch interval in ms (default: 30000)
   * @param {boolean} [options.autoFetch] - Enable automatic fetching (default: true)
   * @param {EventEmitter} eventEmitter - Global event emitter
   */
  constructor(options, eventEmitter) {
    if (!options || !options.repoUrl) {
      throw new Error('GitFilingProvider requires repoUrl in options');
    }

    this.repoUrl = options.repoUrl;
    this.localPath = path.resolve(options.localPath || './git-repo');
    this.branch = options.branch || 'main';
    this.userId = options.userId || 'default-user';
    this.userEmail = options.userEmail || 'user@example.com';
    this.userName = options.userName || 'NooblyJS User';
    this.auth = options.auth || {};
    this.fetchInterval = options.fetchInterval || 30000; // 30 seconds
    this.autoFetch = options.autoFetch !== false;
    this.eventEmitter_ = eventEmitter;

    this.git = null;
    this.commitQueue = new CommitQueue(
      path.join(this.localPath, '.git-queue'),
      eventEmitter
    );
    
    this._fetchTimer = null;
    this._initialized = false;
    this._lockedFiles = new Set(); // Local file locking
  }

  /**
   * Initializes the Git repository and starts auto-fetch
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    await this._ensureRepository();
    await this.commitQueue.initialize();
    
    if (this.autoFetch) {
      this.startAutoFetch();
    }

    this._initialized = true;
    this.eventEmitter_?.emit('git:initialized', { 
      repoUrl: this.repoUrl, 
      localPath: this.localPath,
      branch: this.branch,
      userId: this.userId 
    });
  }

  /**
   * Ensures the Git repository is cloned and configured
   * @private
   */
  async _ensureRepository() {
    try {
      await fs.access(path.join(this.localPath, '.git'));
      // Repository exists, just initialize git instance
      this.git = simpleGit(this.localPath);
    } catch (error) {
      // Repository doesn't exist, clone it
      await this._cloneRepository();
    }

    // Configure user for commits
    await this.git.addConfig('user.name', this.userName);
    await this.git.addConfig('user.email', this.userEmail);
    
    // Ensure we're on the correct branch
    try {
      await this.git.checkout(this.branch);
    } catch (error) {
      // Branch might not exist locally, try to create it
      try {
        await this.git.checkoutBranch(this.branch, `origin/${this.branch}`);
      } catch (branchError) {
        // Branch might not exist on remote either, that's okay
        this.eventEmitter_?.emit('git:branch-warning', { 
          branch: this.branch, 
          error: branchError.message 
        });
      }
    }
  }

  /**
   * Clones the Git repository
   * @private
   */
  async _cloneRepository() {
    const parentDir = path.dirname(this.localPath);
    await fs.mkdir(parentDir, { recursive: true });

    let cloneUrl = this.repoUrl;
    
    // Handle authentication
    if (this.auth.token && this.auth.username) {
      const urlParts = this.repoUrl.split('://');
      if (urlParts.length === 2) {
        cloneUrl = `${urlParts[0]}://${this.auth.username}:${this.auth.token}@${urlParts[1]}`;
      }
    }

    this.git = simpleGit(parentDir);
    
    try {
      await this.git.clone(cloneUrl, this.localPath);
      this.git = simpleGit(this.localPath);
      
      this.eventEmitter_?.emit('git:cloned', { 
        repoUrl: this.repoUrl, 
        localPath: this.localPath 
      });
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * Starts automatic fetching from remote
   */
  startAutoFetch() {
    if (this._fetchTimer) return;

    this._fetchTimer = setInterval(async () => {
      try {
        await this.fetch();
      } catch (error) {
        this.eventEmitter_?.emit('git:fetch-error', { error: error.message });
      }
    }, this.fetchInterval);

    this.eventEmitter_?.emit('git:auto-fetch-started', { interval: this.fetchInterval });
  }

  /**
   * Stops automatic fetching
   */
  stopAutoFetch() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
      this.eventEmitter_?.emit('git:auto-fetch-stopped');
    }
  }

  /**
   * Fetches changes from remote repository
   * @returns {Promise<void>}
   */
  async fetch() {
    await this._ensureInitialized();
    
    try {
      const fetchResult = await this.git.fetch();
      
      // Check if there are new commits
      const status = await this.git.status();
      if (status.behind > 0) {
        // There are new commits, pull them
        await this._pullWithConflictResolution();
      }
      
      this.eventEmitter_?.emit('git:fetched', { 
        result: fetchResult, 
        behind: status.behind 
      });
    } catch (error) {
      this.eventEmitter_?.emit('git:fetch-error', { error: error.message });
      throw error;
    }
  }

  /**
   * Pulls changes with automatic conflict resolution (latest wins)
   * @private
   */
  async _pullWithConflictResolution() {
    try {
      await this.git.pull();
      this.eventEmitter_?.emit('git:pulled', { strategy: 'clean' });
    } catch (error) {
      if (error.message.includes('conflict') || error.message.includes('merge')) {
        // Handle merge conflicts with "latest wins" strategy
        await this._resolveConflictsLatestWins();
        this.eventEmitter_?.emit('git:pulled', { strategy: 'latest-wins' });
      } else {
        throw error;
      }
    }
  }

  /**
   * Resolves merge conflicts using "latest wins" strategy
   * @private
   */
  async _resolveConflictsLatestWins() {
    try {
      // Reset to remote state (latest wins)
      await this.git.reset(['--hard', `origin/${this.branch}`]);
      
      this.eventEmitter_?.emit('git:conflicts-resolved', { 
        strategy: 'latest-wins', 
        message: 'Local changes discarded in favor of remote changes' 
      });
    } catch (error) {
      throw new Error(`Failed to resolve conflicts: ${error.message}`);
    }
  }

  /**
   * Creates a file in the Git repository
   * @param {string} filePath - Relative path to the file
   * @param {Buffer|string} content - File content
   * @returns {Promise<void>}
   */
  async create(filePath, content) {
    await this._ensureInitialized();
    
    if (this._lockedFiles.has(filePath)) {
      throw new Error(`File is locked: ${filePath}`);
    }

    const fullPath = path.join(this.localPath, filePath);
    const dir = path.dirname(fullPath);
    
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
    
    // Add to git staging
    await this.git.add(filePath);
    
    // Add to commit queue (requires user message to actually commit)
    const commitId = await this.commitQueue.addPendingCommit([filePath], this.userId, {
      operation: 'create',
      size: Buffer.byteLength(content)
    });

    this.eventEmitter_?.emit('git:file-created', { 
      path: filePath, 
      commitId,
      staged: true 
    });
  }

  /**
   * Reads a file from the Git repository  
   * @param {string} filePath - Relative path to the file
   * @param {string} [encoding] - File encoding
   * @returns {Promise<Buffer|string>} File content
   */
  async read(filePath, encoding) {
    await this._ensureInitialized();
    
    const fullPath = path.join(this.localPath, filePath);
    
    try {
      const content = await fs.readFile(fullPath, encoding);
      this.eventEmitter_?.emit('git:file-read', { path: filePath });
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Updates a file in the Git repository
   * @param {string} filePath - Relative path to the file  
   * @param {Buffer|string} content - New file content
   * @returns {Promise<void>}
   */
  async update(filePath, content) {
    await this._ensureInitialized();
    
    if (this._lockedFiles.has(filePath)) {
      throw new Error(`File is locked: ${filePath}`);
    }

    const fullPath = path.join(this.localPath, filePath);
    await fs.writeFile(fullPath, content);
    
    // Add to git staging
    await this.git.add(filePath);
    
    // Add to commit queue
    const commitId = await this.commitQueue.addPendingCommit([filePath], this.userId, {
      operation: 'update',
      size: Buffer.byteLength(content)
    });

    this.eventEmitter_?.emit('git:file-updated', { 
      path: filePath, 
      commitId,
      staged: true 
    });
  }

  /**
   * Deletes a file from the Git repository
   * @param {string} filePath - Relative path to the file
   * @returns {Promise<void>}
   */
  async delete(filePath) {
    await this._ensureInitialized();
    
    if (this._lockedFiles.has(filePath)) {
      throw new Error(`File is locked: ${filePath}`);
    }

    const fullPath = path.join(this.localPath, filePath);
    
    try {
      await fs.unlink(fullPath);
      
      // Remove from git
      await this.git.rm(filePath);
      
      // Add to commit queue
      const commitId = await this.commitQueue.addPendingCommit([filePath], this.userId, {
        operation: 'delete'
      });

      this.eventEmitter_?.emit('git:file-deleted', { 
        path: filePath, 
        commitId,
        staged: true 
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, that's okay for delete
        return;
      }
      throw error;
    }
  }

  /**
   * Lists files in a directory in the Git repository
   * @param {string} dirPath - Relative directory path
   * @returns {Promise<Array<string>>} Array of file names
   */
  async list(dirPath = '.') {
    await this._ensureInitialized();
    
    const fullPath = path.join(this.localPath, dirPath);
    
    try {
      const files = await fs.readdir(fullPath);
      // Filter out .git directory and other hidden files
      const filteredFiles = files.filter(file => 
        !file.startsWith('.') || file === '.gitkeep'
      );
      
      this.eventEmitter_?.emit('git:directory-listed', { 
        path: dirPath, 
        count: filteredFiles.length 
      });
      
      return filteredFiles;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Locks a file to prevent concurrent modifications
   * @param {string} filePath - Path to the file
   * @param {string} [reason] - Lock reason
   * @returns {Promise<void>}
   */
  async lockFile(filePath, reason = 'Editing') {
    await this._ensureInitialized();
    
    if (this._lockedFiles.has(filePath)) {
      throw new Error(`File is already locked: ${filePath}`);
    }

    this._lockedFiles.add(filePath);
    
    this.eventEmitter_?.emit('git:file-locked', { 
      path: filePath, 
      reason, 
      userId: this.userId 
    });
  }

  /**
   * Unlocks a file
   * @param {string} filePath - Path to the file
   * @returns {Promise<void>}
   */
  async unlockFile(filePath) {
    await this._ensureInitialized();
    
    if (!this._lockedFiles.has(filePath)) {
      throw new Error(`File is not locked: ${filePath}`);
    }

    this._lockedFiles.delete(filePath);
    
    this.eventEmitter_?.emit('git:file-unlocked', { 
      path: filePath, 
      userId: this.userId 
    });
  }

  /**
   * Commits pending changes with a user-provided message
   * @param {string} commitId - The pending commit ID
   * @param {string} commitMessage - The commit message
   * @param {string} [userId] - User ID (for verification)
   * @returns {Promise<void>}
   */
  async commitWithMessage(commitId, commitMessage, userId = this.userId) {
    await this._ensureInitialized();
    
    const completedCommit = await this.commitQueue.completePendingCommit(
      commitId, 
      commitMessage, 
      userId
    );
    
    try {
      // Make the actual Git commit
      const commitResult = await this.git.commit(commitMessage);
      
      this.eventEmitter_?.emit('git:committed', {
        commitId,
        commitMessage,
        files: completedCommit.files,
        hash: commitResult.commit,
        userId
      });

      return commitResult;
    } catch (error) {
      // If commit fails, put it back in the queue
      await this.commitQueue.addPendingCommit(
        completedCommit.files,
        userId,
        { ...completedCommit.metadata, retry: true }
      );
      
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }

  /**
   * Pushes committed changes to remote repository
   * @returns {Promise<void>}
   */
  async push() {
    await this._ensureInitialized();
    
    try {
      const pushResult = await this.git.push('origin', this.branch);
      
      this.eventEmitter_?.emit('git:pushed', { 
        result: pushResult,
        branch: this.branch 
      });
      
      return pushResult;
    } catch (error) {
      // If push fails due to conflicts, try to resolve and retry
      if (error.message.includes('rejected') || error.message.includes('non-fast-forward')) {
        await this.fetch(); // This will pull and resolve conflicts
        
        // Retry push
        const retryResult = await this.git.push('origin', this.branch);
        
        this.eventEmitter_?.emit('git:pushed', { 
          result: retryResult,
          branch: this.branch,
          retry: true 
        });
        
        return retryResult;
      }
      
      throw new Error(`Failed to push: ${error.message}`);
    }
  }

  /**
   * Gets Git repository status
   * @returns {Promise<Object>} Git status information
   */
  async getStatus() {
    await this._ensureInitialized();
    
    const status = await this.git.status();
    const pendingCommits = this.commitQueue.getAllPendingCommits();
    
    return {
      git: status,
      pendingCommits: pendingCommits.length,
      lockedFiles: Array.from(this._lockedFiles),
      branch: this.branch,
      userId: this.userId,
      autoFetch: this.autoFetch,
      fetchInterval: this.fetchInterval
    };
  }

  /**
   * Gets pending commits waiting for messages
   * @param {string} [userId] - Filter by user ID
   * @returns {Array<Object>} Array of pending commits
   */
  getPendingCommits(userId = null) {
    if (userId) {
      return this.commitQueue.getPendingCommitsByUser(userId);
    }
    return this.commitQueue.getAllPendingCommits();
  }

  /**
   * Cancels a pending commit
   * @param {string} commitId - The commit ID to cancel
   * @param {string} [userId] - User ID (for verification)
   * @returns {Promise<void>}
   */
  async cancelCommit(commitId, userId = this.userId) {
    await this.commitQueue.cancelPendingCommit(commitId, userId);
    
    // TODO: Unstage the files if needed
    // This would require tracking which files were staged for each commit
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

  /**
   * Cleanup resources when shutting down
   */
  async cleanup() {
    this.stopAutoFetch();
    this._initialized = false;
  }
}

module.exports = GitFilingProvider;