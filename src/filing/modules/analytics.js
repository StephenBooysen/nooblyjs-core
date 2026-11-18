/**
 * @fileoverview Filing Analytics Module
 * Tracks file operations (reads, writes, deletes) for analytics and monitoring.
 * Provides an unobtrusive way to collect metrics without impacting provider performance.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

/**
 * Filing Analytics Manager
 * Tracks file and folder operations for monitoring and analytics purposes
 */
class FilingAnalytics {
  constructor() {
    // Map to store analytics data: path -> { reads, writes, deletes, lastAccess }
    this.analytics = new Map();
  }

  /**
   * Extract folder path from file path
   * @param {string} path - The file or folder path
   * @return {string} The folder path
   * @private
   */
  _getFolderPath(path) {
    if (!path) return '/';

    // Normalize path separators
    const normalizedPath = path.replace(/\\/g, '/');

    // If it's already a folder (ends with /), return as is
    if (normalizedPath.endsWith('/')) {
      return normalizedPath;
    }

    // Extract folder from file path
    const lastSlash = normalizedPath.lastIndexOf('/');
    if (lastSlash === -1) {
      return '/'; // Root folder
    }

    return normalizedPath.substring(0, lastSlash) || '/';
  }

  /**
   * Track a read operation
   * @param {string} path - The path that was read
   */
  trackRead(path) {
    if (!path) return;

    const folderPath = this._getFolderPath(path);

    if (!this.analytics.has(folderPath)) {
      this.analytics.set(folderPath, {
        path: folderPath,
        reads: 0,
        writes: 0,
        deletes: 0,
        lastAccess: new Date().toISOString()
      });
    }

    const stats = this.analytics.get(folderPath);
    stats.reads++;
    stats.lastAccess = new Date().toISOString();
  }

  /**
   * Track a write operation
   * @param {string} path - The path that was written
   */
  trackWrite(path) {
    if (!path) return;

    const folderPath = this._getFolderPath(path);

    if (!this.analytics.has(folderPath)) {
      this.analytics.set(folderPath, {
        path: folderPath,
        reads: 0,
        writes: 0,
        deletes: 0,
        lastAccess: new Date().toISOString()
      });
    }

    const stats = this.analytics.get(folderPath);
    stats.writes++;
    stats.lastAccess = new Date().toISOString();
  }

  /**
   * Track a delete operation
   * @param {string} path - The path that was deleted
   */
  trackDelete(path) {
    if (!path) return;

    const folderPath = this._getFolderPath(path);

    if (!this.analytics.has(folderPath)) {
      this.analytics.set(folderPath, {
        path: folderPath,
        reads: 0,
        writes: 0,
        deletes: 0,
        lastAccess: new Date().toISOString()
      });
    }

    const stats = this.analytics.get(folderPath);
    stats.deletes++;
    stats.lastAccess = new Date().toISOString();
  }

  /**
   * Get analytics data sorted by total activity
   * @param {number} [limit=250] - Maximum number of entries to return
   * @return {Array<Object>} Array of analytics objects
   */
  getAnalytics(limit = 250) {
    // Convert map to array
    const analyticsArray = Array.from(this.analytics.values());

    // Sort by total activity (reads + writes + deletes) descending
    analyticsArray.sort((a, b) => {
      const totalA = a.reads + a.writes + a.deletes;
      const totalB = b.reads + b.writes + b.deletes;
      return totalB - totalA;
    });

    // Return top entries up to the limit
    return analyticsArray.slice(0, limit);
  }

  /**
   * Get aggregated statistics
   * @return {Object} Statistics object
   */
  getStats() {
    let totalReads = 0;
    let totalWrites = 0;
    let totalDeletes = 0;
    const totalPaths = this.analytics.size;

    for (const stats of this.analytics.values()) {
      totalReads += stats.reads;
      totalWrites += stats.writes;
      totalDeletes += stats.deletes;
    }

    return {
      totalPaths,
      totalReads,
      totalWrites,
      totalDeletes,
      totalOperations: totalReads + totalWrites + totalDeletes
    };
  }

  /**
   * Clear all analytics data
   */
  clear() {
    this.analytics.clear();
  }

  /**
   * Get analytics data for a specific path
   * @param {string} path - The path to get analytics for
   * @return {Object|null} Analytics object or null if not found
   */
  getPathAnalytics(path) {
    const folderPath = this._getFolderPath(path);
    return this.analytics.get(folderPath) || null;
  }
}

// Create singleton instance
const filingAnalytics = new FilingAnalytics();

module.exports = filingAnalytics;
