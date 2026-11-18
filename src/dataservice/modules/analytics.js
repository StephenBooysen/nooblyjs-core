/**
 * @fileoverview DataService Analytics Module
 * Tracks data operations (add, remove, find) for analytics and monitoring.
 * Provides an unobtrusive way to collect metrics without impacting provider performance.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

/**
 * DataService Analytics Manager
 * Tracks container operations for monitoring and analytics purposes
 */
class DataServiceAnalytics {
  constructor() {
    // Map to store container analytics: containerName -> { container, adds, removes, finds, updates }
    this.containers = new Map();

    // Total operation counters
    this.totals = {
      adds: 0,
      removes: 0,
      finds: 0,
      updates: 0
    };
  }

  /**
   * Track an add operation
   * @param {string} containerName - The container name
   */
  trackAdd(containerName) {
    if (!containerName) return;

    this.totals.adds++;

    if (!this.containers.has(containerName)) {
      this.containers.set(containerName, {
        container: containerName,
        adds: 0,
        removes: 0,
        finds: 0,
        updates: 0
      });
    }

    const stats = this.containers.get(containerName);
    stats.adds++;
  }

  /**
   * Track a remove operation
   * @param {string} containerName - The container name
   */
  trackRemove(containerName) {
    if (!containerName) return;

    this.totals.removes++;

    if (!this.containers.has(containerName)) {
      this.containers.set(containerName, {
        container: containerName,
        adds: 0,
        removes: 0,
        finds: 0,
        updates: 0
      });
    }

    const stats = this.containers.get(containerName);
    stats.removes++;
  }

  /**
   * Track a find operation
   * @param {string} containerName - The container name
   */
  trackFind(containerName) {
    if (!containerName) return;

    this.totals.finds++;

    if (!this.containers.has(containerName)) {
      this.containers.set(containerName, {
        container: containerName,
        adds: 0,
        removes: 0,
        finds: 0,
        updates: 0
      });
    }

    const stats = this.containers.get(containerName);
    stats.finds++;
  }

  /**
   * Track an update operation
   * @param {string} containerName - The container name
   */
  trackUpdate(containerName) {
    if (!containerName) return;

    this.totals.updates++;

    if (!this.containers.has(containerName)) {
      this.containers.set(containerName, {
        container: containerName,
        adds: 0,
        removes: 0,
        finds: 0,
        updates: 0
      });
    }

    const stats = this.containers.get(containerName);
    stats.updates++;
  }

  /**
   * Get container analytics sorted by total actions
   * @param {number} [limit=100] - Maximum number of entries to return
   * @return {Array<Object>} Array of container analytics objects
   */
  getContainerAnalytics(limit = 100) {
    // Convert map to array
    const analyticsArray = Array.from(this.containers.values());

    // Calculate total actions and sort by total descending
    analyticsArray.forEach(item => {
      item.totalActions = item.adds + item.removes + item.finds + (item.updates || 0);
    });

    analyticsArray.sort((a, b) => b.totalActions - a.totalActions);

    // Return top entries up to the limit
    return analyticsArray.slice(0, limit);
  }

  /**
   * Get total statistics
   * @return {Object} Statistics object
   */
  getTotalStats() {
    return {
      ...this.totals,
      totalContainers: this.containers.size,
      totalActions: this.totals.adds + this.totals.removes + this.totals.finds + this.totals.updates
    };
  }

  /**
   * Get all analytics data
   * @return {Object} Complete analytics data
   */
  getAllAnalytics() {
    return {
      totals: this.getTotalStats(),
      containers: this.getContainerAnalytics(100)
    };
  }

  /**
   * Clear all analytics data
   */
  clear() {
    this.containers.clear();
    this.totals = {
      adds: 0,
      removes: 0,
      finds: 0,
      updates: 0
    };
  }

  /**
   * Get analytics for a specific container
   * @param {string} containerName - The container name to get analytics for
   * @return {Object|null} Analytics object or null if not found
   */
  getContainerStats(containerName) {
    return this.containers.get(containerName) || null;
  }
}

// Create singleton instance
const dataServiceAnalytics = new DataServiceAnalytics();

module.exports = dataServiceAnalytics;
