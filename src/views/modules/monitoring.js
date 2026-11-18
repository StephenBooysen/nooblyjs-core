/**
 * @fileoverview System Monitoring Module
 * Tracks system metrics (RAM, CPU, threads, event loop lag, GC metrics) for the Service Registry dashboard.
 * Keeps metrics in memory with a rolling window of data points using perf_hooks for detailed performance insights.
 *
 * @author NooblyJS Team
 * @version 2.0.0
 */

'use strict';

const os = require('os');
const v8 = require('v8');
const { performance, PerformanceObserver } = require('perf_hooks');
const { constants } = require('perf_hooks');

/**
 * System Monitoring Manager
 * Collects and stores system metrics including perf_hooks data for visualization
 */
class SystemMonitoring {
  constructor() {
    // Optional logging service. Injected post-construction via setLogger() so
    // this foundational module can be required before the logging service
    // exists. All logging uses optional chaining to fail silently when unset.
    this.logger = null;

    // Store up to 60 data points (for 60 seconds of data if collected every second)
    this.maxDataPoints = 60;
    this.metrics = {
      ram: [], // { timestamp, used, total, percentage }
      cpu: [], // { timestamp, usage }
      threads: [], // { timestamp, active, idle }
      eventLoop: [], // { timestamp, delay }
      gc: [], // { timestamp, type, duration, kind }
      memory: [], // { timestamp, heapUsed, heapTotal, external, arrayBuffers }
      performanceMarks: [] // { name, duration, timestamp }
    };

    // Track event loop lag
    this.eventLoopMonitor = null;
    this.lastEventLoopCheck = Date.now();
    this.eventLoopLag = 0;

    // Track GC events
    this.gcObserver = null;
    this.lastGCCount = {};

    // Performance marks for custom operations
    this.marks = new Map();
    this.maxMarksPerName = 20;

    // Start collecting metrics
    this.startCollecting();
    this._initializePerformanceTracking();
  }

  /**
   * Inject a logging service after construction.
   * @param {Object} logger - Logging service exposing error/warn/info methods.
   * @public
   */
  setLogger(logger) {
    this.logger = logger || null;
  }

  /**
   * Get memory usage in MB including heap and external memory details
   * @return {Object} Memory usage information
   * @private
   */
  _getMemoryUsage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const heapStats = v8.getHeapStatistics();
    const processMemory = process.memoryUsage();

    return {
      timestamp: Date.now(),
      total: Math.round(totalMemory / (1024 * 1024)), // MB
      used: Math.round(usedMemory / (1024 * 1024)), // MB
      free: Math.round(freeMemory / (1024 * 1024)), // MB
      percentage: Math.round((usedMemory / totalMemory) * 100),
      heap: {
        total: Math.round(heapStats.total_heap_size / (1024 * 1024)), // MB
        used: Math.round(heapStats.used_heap_size / (1024 * 1024)), // MB
        limit: Math.round(heapStats.heap_size_limit / (1024 * 1024)) // MB
      },
      process: {
        rss: Math.round(processMemory.rss / (1024 * 1024)), // MB
        heapUsed: Math.round(processMemory.heapUsed / (1024 * 1024)), // MB
        heapTotal: Math.round(processMemory.heapTotal / (1024 * 1024)), // MB
        external: Math.round(processMemory.external / (1024 * 1024)), // MB
        arrayBuffers: Math.round((processMemory.arrayBuffers || 0) / (1024 * 1024)) // MB
      }
    };
  }

  /**
   * Measure event loop lag
   * Indicates how much time the event loop is blocked
   * @return {Object} Event loop lag information
   * @private
   */
  _measureEventLoopLag() {
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastEventLoopCheck;
    this.lastEventLoopCheck = now;

    return {
      timestamp: now,
      delay: Math.max(0, this.eventLoopLag),
      blockingDuration: timeSinceLastCheck
    };
  }

  /**
   * Get garbage collection metrics
   * @return {Object} GC event information
   * @private
   */
  _getGCMetrics() {
    const heapStats = v8.getHeapStatistics();
    const heapSpaces = v8.getHeapSpaceStatistics();

    return {
      timestamp: Date.now(),
      heapStats: {
        totalHeapSize: Math.round(heapStats.total_heap_size / (1024 * 1024)),
        executableSize: Math.round(heapStats.total_executable_size / (1024 * 1024)),
        physicalSize: Math.round(heapStats.total_physical_size / (1024 * 1024))
      },
      spaces: heapSpaces.map(space => ({
        name: space.space_name,
        size: Math.round(space.space_size / (1024 * 1024)),
        used: Math.round(space.space_used_size / (1024 * 1024)),
        available: Math.round(space.space_available_size / (1024 * 1024))
      }))
    };
  }

  /**
   * Get CPU usage percentage
   * Uses a sampling approach to calculate CPU usage
   * @return {Object} CPU usage information
   * @private
   */
  _getCPUUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);

    return {
      timestamp: Date.now(),
      usage: usage,
      cores: cpus.length,
      model: cpus[0].model
    };
  }

  /**
   * Get thread/worker information from libuv
   * @return {Object} Thread information
   * @private
   */
  _getThreadInfo() {
    // Get active handles and requests from libuv
    const handles = process._getActiveHandles ? process._getActiveHandles().length : 0;
    const requests = process._getActiveRequests ? process._getActiveRequests().length : 0;

    return {
      timestamp: Date.now(),
      active: handles,
      requests: requests,
      total: handles + requests
    };
  }

  /**
   * Add a data point to a metric array, maintaining the max size
   * @param {Array} array - The metric array
   * @param {Object} dataPoint - The data point to add
   * @private
   */
  _addDataPoint(array, dataPoint) {
    array.push(dataPoint);
    if (array.length > this.maxDataPoints) {
      array.shift(); // Remove oldest data point
    }
  }

  /**
   * Initialize performance tracking with GC observer and event loop measurement
   * @private
   */
  _initializePerformanceTracking() {
    try {
      // Setup GC observer for garbage collection metrics
      try {
        this.gcObserver = new PerformanceObserver((items) => {
          items.getEntries().forEach((entry) => {
            const gcData = {
              timestamp: Date.now(),
              type: entry.name,
              duration: Math.round(entry.duration * 100) / 100, // Round to 2 decimals
              kind: entry.detail?.kind === 0 ? 'Scavenge' :
                    entry.detail?.kind === 1 ? 'MarkSweepCompact' :
                    entry.detail?.kind === 2 ? 'IncrementalMarking' : 'Unknown'
            };
            this._addDataPoint(this.metrics.gc, gcData);
          });
        });
        this.gcObserver.observe({ entryTypes: ['gc'], buffered: true });
      } catch (gcErr) {
        // GC monitoring may not be available in all environments
        this.logger?.warn?.('[SystemMonitoring] GC observer initialization failed', { error: gcErr.message });
      }

      // Setup event loop lag measurement using setImmediate
      this._monitorEventLoop();
    } catch (error) {
      this.logger?.error?.('[SystemMonitoring] Performance tracking initialization failed', { error: error.message });
    }
  }

  /**
   * Monitor event loop lag using a high-resolution timer
   * @private
   */
  _monitorEventLoop() {
    this.eventLoopMonitor = setImmediate(() => {
      const now = Date.now();
      this.eventLoopLag = Math.max(0, now - this.lastEventLoopCheck - 1000);

      // Schedule next check recursively. Track and unref the timer so it can be
      // cleared on teardown and never keeps the event loop (or a Jest worker)
      // alive by itself.
      this.eventLoopTimer = setTimeout(() => this._monitorEventLoop(), 100);
      if (typeof this.eventLoopTimer.unref === 'function') {
        this.eventLoopTimer.unref();
      }
    });
    if (this.eventLoopMonitor && typeof this.eventLoopMonitor.unref === 'function') {
      this.eventLoopMonitor.unref();
    }
  }

  /**
   * Record a performance mark for custom operations
   * Used by services to track operation timing
   * @param {string} name - Name of the operation
   * @param {number} duration - Duration in milliseconds
   * @public
   */
  recordMark(name, duration) {
    if (!name || typeof duration !== 'number') {
      return;
    }

    const markData = {
      name,
      duration: Math.round(duration * 100) / 100,
      timestamp: Date.now()
    };

    this._addDataPoint(this.metrics.performanceMarks, markData);

    // Also track by name for aggregated statistics
    if (!this.marks.has(name)) {
      this.marks.set(name, []);
    }
    const marks = this.marks.get(name);
    marks.push(duration);
    if (marks.length > this.maxMarksPerName) {
      marks.shift();
    }
  }

  /**
   * Get performance mark statistics for a specific operation
   * @param {string} name - Name of the operation
   * @return {Object} Statistics including min, max, avg, count
   * @public
   */
  getMarkStats(name) {
    const marks = this.marks.get(name) || [];
    if (marks.length === 0) {
      return null;
    }

    const min = Math.min(...marks);
    const max = Math.max(...marks);
    const avg = marks.reduce((a, b) => a + b, 0) / marks.length;

    return {
      name,
      count: marks.length,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      avg: Math.round(avg * 100) / 100
    };
  }

  /**
   * Get all performance mark statistics
   * @return {Array} Array of mark statistics
   * @public
   */
  getAllMarkStats() {
    const stats = [];
    for (const [name] of this.marks) {
      const stat = this.getMarkStats(name);
      if (stat) {
        stats.push(stat);
      }
    }
    return stats;
  }

  /**
   * Collect current metrics
   * @private
   */
  _collectMetrics() {
    try {
      // Collect RAM metrics
      const ramData = this._getMemoryUsage();
      this._addDataPoint(this.metrics.ram, ramData);

      // Collect CPU metrics
      const cpuData = this._getCPUUsage();
      this._addDataPoint(this.metrics.cpu, cpuData);

      // Collect thread metrics
      const threadData = this._getThreadInfo();
      this._addDataPoint(this.metrics.threads, threadData);

      // Collect event loop lag metrics
      const eventLoopData = this._measureEventLoopLag();
      this._addDataPoint(this.metrics.eventLoop, eventLoopData);

      // Collect GC metrics
      const gcMetrics = this._getGCMetrics();
      this._addDataPoint(this.metrics.memory, gcMetrics);
    } catch (error) {
      this.logger?.error?.('[SystemMonitoring] Error collecting metrics', { error: error.message });
    }
  }

  /**
   * Start collecting metrics at regular intervals
   */
  startCollecting() {
    // Collect initial metrics immediately
    this._collectMetrics();

    // Then collect every second. unref() so this background timer never keeps
    // the process (or the Jest worker) alive on its own.
    this.collectionInterval = setInterval(() => {
      this._collectMetrics();
    }, 1000);
    if (typeof this.collectionInterval.unref === 'function') {
      this.collectionInterval.unref();
    }
  }

  /**
   * Stop collecting metrics
   */
  stopCollecting() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    // Clear the recursive event-loop lag monitor (both the pending setImmediate
    // and the scheduled setTimeout) so nothing keeps the event loop alive.
    if (this.eventLoopMonitor) {
      clearImmediate(this.eventLoopMonitor);
      this.eventLoopMonitor = null;
    }
    if (this.eventLoopTimer) {
      clearTimeout(this.eventLoopTimer);
      this.eventLoopTimer = null;
    }

    // Clean up performance observer
    if (this.gcObserver) {
      this.gcObserver.disconnect();
      this.gcObserver = null;
    }
  }

  /**
   * Get all current metrics including perf_hooks data
   * @return {Object} All metrics data
   */
  getMetrics() {
    return {
      ram: this.metrics.ram,
      cpu: this.metrics.cpu,
      threads: this.metrics.threads,
      eventLoop: this.metrics.eventLoop,
      gc: this.metrics.gc,
      memory: this.metrics.memory,
      performanceMarks: this.metrics.performanceMarks,
      markStatistics: this.getAllMarkStats(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        nodeVersion: process.version
      }
    };
  }

  /**
   * Get current snapshot of metrics (latest values only)
   * @return {Object} Current metric values
   */
  getCurrentSnapshot() {
    const ram = this.metrics.ram[this.metrics.ram.length - 1] || {};
    const cpu = this.metrics.cpu[this.metrics.cpu.length - 1] || {};
    const threads = this.metrics.threads[this.metrics.threads.length - 1] || {};
    const eventLoop = this.metrics.eventLoop[this.metrics.eventLoop.length - 1] || {};
    const gc = this.metrics.memory[this.metrics.memory.length - 1] || {};

    return {
      ram,
      cpu,
      threads,
      eventLoop,
      gc,
      markStatistics: this.getAllMarkStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Clear all metrics data
   */
  clear() {
    this.metrics.ram = [];
    this.metrics.cpu = [];
    this.metrics.threads = [];
    this.metrics.eventLoop = [];
    this.metrics.gc = [];
    this.metrics.memory = [];
    this.metrics.performanceMarks = [];
    this.marks.clear();
  }
}

// Create singleton instance
const systemMonitoring = new SystemMonitoring();

module.exports = systemMonitoring;
