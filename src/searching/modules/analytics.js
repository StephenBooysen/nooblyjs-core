/**
 * @fileoverview Searching Analytics Module
 * Tracks search operations (add, read, delete, search) for analytics and monitoring.
 * Provides an unobtrusive way to collect metrics without impacting provider performance.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

/**
 * Searching Analytics Manager
 * Tracks search operations and search terms for monitoring and analytics purposes
 */
class SearchingAnalytics {
  constructor() {
    /** @private @type {Map<string, {operations: Object, searchTerms: Map<string, Object>}>} */
    this.analyticsByIndex_ = new Map();
  }

  /**
   * Ensures analytics storage exists for an index.
   * @param {string} indexName
   * @return {{operations: Object, searchTerms: Map<string, Object>}}
   * @private
   */
  getIndexAnalytics_(indexName) {
    const resolved = this.normalizeIndex_(indexName);
    if (!this.analyticsByIndex_.has(resolved)) {
      this.analyticsByIndex_.set(resolved, {
        operations: { adds: 0, deletes: 0, searches: 0 },
        searchTerms: new Map()
      });
    }
    return this.analyticsByIndex_.get(resolved);
  }

  /**
   * Normalizes an index name to a consistent string.
   * @param {string=} indexName
   * @return {string}
   * @private
   */
  normalizeIndex_(indexName) {
    if (typeof indexName === 'string') {
      const trimmed = indexName.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return 'default';
  }

  /**
   * Updates counters for a specific operation.
   * @param {string} field
   * @param {string=} indexName
   * @private
   */
  incrementOperation_(field, indexName) {
    const analytics = this.getIndexAnalytics_(indexName);
    analytics.operations[field]++;
  }

  trackAdd(indexName) {
    this.incrementOperation_('adds', indexName);
  }

  trackDelete(indexName) {
    this.incrementOperation_('deletes', indexName);
  }

  trackSearch(searchTerm, resultCount = 0, indexName) {
    if (!searchTerm) {
      return;
    }

    this.incrementOperation_('searches', indexName);
    this.updateSearchTermStats_(searchTerm, resultCount, indexName);
  }

  /**
   * Updates search term statistics for a specific index key.
   * @param {string} searchTerm
   * @param {number} resultCount
   * @param {string=} indexName
   * @private
   */
  updateSearchTermStats_(searchTerm, resultCount, indexName) {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    const resolvedIndex = this.normalizeIndex_(indexName);
    const analyticsBucket = this.getIndexAnalytics_(resolvedIndex);
    const termMap = analyticsBucket.searchTerms;

    if (!termMap.has(normalizedTerm)) {
      termMap.set(normalizedTerm, {
        term: searchTerm.trim(),
        callCount: 0,
        count: 0,
        totalResults: 0,
        lastCalled: null,
        index: resolvedIndex
      });
    }

    const stats = termMap.get(normalizedTerm);
    stats.callCount++;
    stats.count = stats.callCount;
    stats.totalResults += resultCount || 0;
    stats.lastCalled = new Date().toISOString();
  }

  /**
   * Gets search term analytics.
   * @param {number=} limit
   * @param {string=} indexName
   * @return {Array<Object>}
   */
  getSearchTermAnalytics(limit = 100, indexName) {
    const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    let analyticsArray = [];

    if (indexName) {
      const termsMap = this.getIndexAnalytics_(indexName).searchTerms;
      analyticsArray = Array.from(termsMap.values());
    } else {
      this.analyticsByIndex_.forEach((bucket, idxName) => {
        bucket.searchTerms.forEach((value) => {
          analyticsArray.push({
            term: value.term,
            callCount: value.callCount,
            count: value.callCount,
            totalResults: value.totalResults,
            lastCalled: value.lastCalled,
            index: idxName
          });
        });
      });
    }

    analyticsArray.sort((a, b) => b.callCount - a.callCount);
    return analyticsArray.slice(0, effectiveLimit);
  }

  /**
   * Gets operation statistics.
   * @param {string=} indexName
   * @return {Object}
   */
  getOperationStats(indexName) {
    if (indexName) {
      const normalized = this.normalizeIndex_(indexName);
      const data = this.getIndexAnalytics_(normalized);
      return {
        ...data.operations,
        totalSearchTerms: data.searchTerms.size,
        index: normalized
      };
    }

    const aggregate = { adds: 0, deletes: 0, searches: 0 };
    let termCount = 0;

    this.analyticsByIndex_.forEach((bucket) => {
      aggregate.adds += bucket.operations.adds;
      aggregate.deletes += bucket.operations.deletes;
      aggregate.searches += bucket.operations.searches;
      termCount += bucket.searchTerms.size;
    });

    return {
      ...aggregate,
      totalSearchTerms: termCount
    };
  }

  /**
   * Gets combined analytics payload.
   * @param {Object=} options
   * @param {string=} options.searchContainer
   * @param {number=} options.limit
   * @return {Object}
   */
  getAllAnalytics(options = {}) {
    const { searchContainer, limit } = options;
    return {
      operations: this.getOperationStats(searchContainer),
      searchTerms: this.getSearchTermAnalytics(limit, searchContainer),
      indexes: this.getIndexSummaries_()
    };
  }

  /**
   * Provides lightweight per-index summary metadata.
   * @return {Array<Object>}
   * @private
   */
  getIndexSummaries_() {
    const summaries = [];
    this.analyticsByIndex_.forEach((bucket, idxName) => {
      summaries.push({
        index: idxName,
        operations: { ...bucket.operations },
        totalSearchTerms: bucket.searchTerms.size
      });
    });
    return summaries;
  }

  clear() {
    this.analyticsByIndex_.clear();
  }

  getTermAnalytics(searchTerm, indexName) {
    if (!searchTerm) {
      return null;
    }
    const normalizedTerm = searchTerm.trim().toLowerCase();
    if (indexName) {
      const bucket = this.getIndexAnalytics_(indexName).searchTerms;
      return bucket.get(normalizedTerm) || null;
    }

    for (const bucket of this.analyticsByIndex_.values()) {
      if (bucket.searchTerms.has(normalizedTerm)) {
        return bucket.searchTerms.get(normalizedTerm);
      }
    }
    return null;
  }
}

module.exports = new SearchingAnalytics();
