/**
 * @fileoverview Commit Queue for Git Filing Provider
 * Manages pending commits that require user-provided commit messages
 * @author NooblyJS Team
 * @version 1.0.15
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Manages a queue of pending commits waiting for user messages
 */
class CommitQueue {
  /**
   * Creates a new CommitQueue instance
   * @param {string} queueDir - Directory to store commit queue data
   * @param {EventEmitter} eventEmitter - Event emitter for notifications
   */
  constructor(queueDir = './.git-queue', eventEmitter) {
    this.queueDir = path.resolve(queueDir);
    this.queueFile = path.join(this.queueDir, 'pending-commits.json');
    this.eventEmitter_ = eventEmitter;
    this.pendingCommits = [];
    this._initialized = false;
  }

  /**
   * Initializes the commit queue
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    await fs.mkdir(this.queueDir, { recursive: true });
    await this._loadQueue();
    this._initialized = true;
  }

  /**
   * Loads the commit queue from disk
   * @private
   */
  async _loadQueue() {
    try {
      const data = await fs.readFile(this.queueFile, 'utf8');
      this.pendingCommits = JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to load commit queue: ${error.message}`);
      }
      // File doesn't exist yet, start with empty queue
      this.pendingCommits = [];
    }
  }

  /**
   * Saves the commit queue to disk
   * @private
   */
  async _saveQueue() {
    await fs.writeFile(this.queueFile, JSON.stringify(this.pendingCommits, null, 2));
  }

  /**
   * Adds files to the pending commit queue
   * @param {Array<string>} files - Array of file paths that were modified
   * @param {string} userId - User ID who made the changes
   * @param {Object} metadata - Additional metadata about the changes
   * @returns {Promise<string>} Commit ID for the pending commit
   */
  async addPendingCommit(files, userId, metadata = {}) {
    await this._ensureInitialized();

    const commitId = `commit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const pendingCommit = {
      id: commitId,
      files: [...files], // Clone the array
      userId,
      timestamp: new Date().toISOString(),
      metadata: { ...metadata }
    };

    this.pendingCommits.push(pendingCommit);
    await this._saveQueue();
    
    this.eventEmitter_?.emit('commit:queued', { 
      commitId, 
      files, 
      userId,
      totalPending: this.pendingCommits.length 
    });

    return commitId;
  }

  /**
   * Gets a pending commit by ID
   * @param {string} commitId - The commit ID
   * @returns {Object|null} The pending commit or null if not found
   */
  getPendingCommit(commitId) {
    return this.pendingCommits.find(commit => commit.id === commitId) || null;
  }

  /**
   * Gets all pending commits
   * @returns {Array<Object>} Array of pending commits
   */
  getAllPendingCommits() {
    return [...this.pendingCommits]; // Return a copy
  }

  /**
   * Gets pending commits for a specific user
   * @param {string} userId - The user ID
   * @returns {Array<Object>} Array of pending commits for the user
   */
  getPendingCommitsByUser(userId) {
    return this.pendingCommits.filter(commit => commit.userId === userId);
  }

  /**
   * Completes a pending commit with a user-provided message
   * @param {string} commitId - The commit ID
   * @param {string} commitMessage - The commit message provided by the user
   * @param {string} userId - The user ID (for verification)
   * @returns {Promise<Object>} The completed commit information
   */
  async completePendingCommit(commitId, commitMessage, userId) {
    await this._ensureInitialized();

    const commitIndex = this.pendingCommits.findIndex(commit => commit.id === commitId);
    
    if (commitIndex === -1) {
      throw new Error(`Pending commit not found: ${commitId}`);
    }

    const commit = this.pendingCommits[commitIndex];
    
    if (commit.userId !== userId) {
      throw new Error(`Commit ${commitId} belongs to user ${commit.userId}, not ${userId}`);
    }

    // Remove from pending queue
    this.pendingCommits.splice(commitIndex, 1);
    await this._saveQueue();

    const completedCommit = {
      ...commit,
      commitMessage,
      completedAt: new Date().toISOString()
    };

    this.eventEmitter_?.emit('commit:completed', {
      commitId,
      commitMessage,
      files: commit.files,
      userId,
      totalPending: this.pendingCommits.length
    });

    return completedCommit;
  }

  /**
   * Removes a pending commit without completing it
   * @param {string} commitId - The commit ID
   * @param {string} userId - The user ID (for verification)
   * @returns {Promise<void>}
   */
  async cancelPendingCommit(commitId, userId) {
    await this._ensureInitialized();

    const commitIndex = this.pendingCommits.findIndex(commit => commit.id === commitId);
    
    if (commitIndex === -1) {
      throw new Error(`Pending commit not found: ${commitId}`);
    }

    const commit = this.pendingCommits[commitIndex];
    
    if (commit.userId !== userId) {
      throw new Error(`Commit ${commitId} belongs to user ${commit.userId}, not ${userId}`);
    }

    this.pendingCommits.splice(commitIndex, 1);
    await this._saveQueue();

    this.eventEmitter_?.emit('commit:cancelled', {
      commitId,
      files: commit.files,
      userId,
      totalPending: this.pendingCommits.length
    });
  }

  /**
   * Gets the count of pending commits
   * @returns {number} Number of pending commits
   */
  getPendingCount() {
    return this.pendingCommits.length;
  }

  /**
   * Gets the count of pending commits for a specific user
   * @param {string} userId - The user ID
   * @returns {number} Number of pending commits for the user
   */
  getPendingCountByUser(userId) {
    return this.pendingCommits.filter(commit => commit.userId === userId).length;
  }

  /**
   * Clears all pending commits (use with caution)
   * @returns {Promise<void>}
   */
  async clearAll() {
    await this._ensureInitialized();
    
    const count = this.pendingCommits.length;
    this.pendingCommits = [];
    await this._saveQueue();

    this.eventEmitter_?.emit('commit:queue-cleared', { clearedCount: count });
  }

  /**
   * Gets summary statistics about the commit queue
   * @returns {Object} Queue statistics
   */
  getQueueStats() {
    const userStats = {};
    
    for (const commit of this.pendingCommits) {
      if (!userStats[commit.userId]) {
        userStats[commit.userId] = {
          count: 0,
          files: new Set(),
          oldestCommit: commit.timestamp
        };
      }
      
      userStats[commit.userId].count++;
      commit.files.forEach(file => userStats[commit.userId].files.add(file));
      
      if (commit.timestamp < userStats[commit.userId].oldestCommit) {
        userStats[commit.userId].oldestCommit = commit.timestamp;
      }
    }

    // Convert Sets to arrays for JSON serialization
    for (const userId in userStats) {
      userStats[userId].files = Array.from(userStats[userId].files);
    }

    return {
      totalPending: this.pendingCommits.length,
      userStats,
      oldestPending: this.pendingCommits.length > 0 ? 
        Math.min(...this.pendingCommits.map(c => new Date(c.timestamp).getTime())) : null
    };
  }

  /**
   * Ensures the commit queue is initialized
   * @private
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.initialize();
    }
  }
}

module.exports = CommitQueue;