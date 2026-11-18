/**
 * @fileoverview NooblyJS Core Searching Client Library
 * A client-side JavaScript library for interacting with the NooblyJS Core Searching service.
 * This library provides a simple, intuitive API for search operations from web applications.
 * Includes both local (client-side) and remote (server-side) search implementations.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.15
 *
 * @example
 * // Include the library in your HTML
 * <script src="/services/searching/scripts"></script>
 *
 * // Create a remote search instance (server-side)
 * const remoteSearch = new searchService({ provider: 'remote' });
 * let results = await remoteSearch.search('apples');
 *
 * // Create a local search instance (client-side, no provider)
 * const localSearch = new searchService();
 * await localSearch.addDocument({ id: 1, title: 'Apple Pie', content: 'Delicious' });
 * let results = await localSearch.search('apple');
 *
 */

(function(global) {
  'use strict';

  /**
   * Client-side Search Service for NooblyJS Core
   * Supports both remote (server) and local (client) search operations
   *
   * @class searchService
   * @param {Object} options - Configuration options
   * @param {string} [options.provider] - 'remote' for server-side, undefined/null for client-side
   * @param {string} [options.instance] - Instance name for remote searches
   * @param {string} [options.baseUrl] - Base URL for API calls (default: '/services/searching/api')
   */
  function searchService(options) {
    options = options || {};

    this.provider = options.provider || null;
    this.instance = options.instance || 'default';
    this.baseUrl = options.baseUrl || '/services/searching/api';
    this.searchContainer = options.searchContainer || '';

    // Local storage for client-side search
    this.localIndex = new Map();
    this.documentStore = new Map();
    this.documentCounter = 0;
  }

  /**
   * Search for documents
   *
   * @async
   * @param {string} term - The search term
   * @param {string} [container] - Optional search container/index name
   * @returns {Promise<Array>} Array of matching documents
   *
   * @example
   * const results = await searchService.search('test');
   * console.log(results);
   */
  searchService.prototype.search = function(term, container) {
    if (this.provider === 'remote') {
      return this._remoteSearch(term, container);
    } else {
      return this._localSearch(term, container);
    }
  };

  /**
   * Remote search via API
   *
   * @private
   * @async
   * @param {string} term - The search term
   * @param {string} [container] - Optional search container
   * @returns {Promise<Array>} Search results from server
   */
  searchService.prototype._remoteSearch = function(term, container) {
    const self = this;
    return new Promise(function(resolve, reject) {
      const searchContainer = container || self.searchContainer || '';
      let url = self.baseUrl + '/search/' + encodeURIComponent(term);

      if (searchContainer) {
        url += '?searchContainer=' + encodeURIComponent(searchContainer);
      }

      fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Search failed with status ' + response.status);
          }
          return response.json();
        })
        .then(function(data) {
          resolve(data || []);
        })
        .catch(function(error) {
          console.error('Remote search error:', error);
          reject(error);
        });
    });
  };

  /**
   * Local (client-side) search implementation
   * Uses simple text matching across all indexed documents
   *
   * @private
   * @async
   * @param {string} term - The search term
   * @param {string} [container] - Optional container name (for future multi-index support)
   * @returns {Promise<Array>} Matching documents
   */
  searchService.prototype._localSearch = function(term, container) {
    const self = this;
    return new Promise(function(resolve) {
      const results = [];
      const searchTerm = term.toLowerCase();

      // Search through all documents
      self.documentStore.forEach(function(doc) {
        // Search all string properties in the document
        let matchScore = 0;
        for (let key in doc) {
          if (doc.hasOwnProperty(key) && typeof doc[key] === 'string') {
            const value = doc[key].toLowerCase();
            if (value.includes(searchTerm)) {
              matchScore += value.split(searchTerm).length - 1;
            }
          }
        }

        // Include document if there are matches
        if (matchScore > 0) {
          results.push({
            ...doc,
            _matchScore: matchScore
          });
        }
      });

      // Sort by match score
      results.sort(function(a, b) {
        return b._matchScore - a._matchScore;
      });

      resolve(results);
    });
  };

  /**
   * Add a document to the search index
   *
   * @async
   * @param {Object} document - The document to add
   * @param {string} [key] - Optional document key (auto-generated if not provided)
   * @param {string} [container] - Optional search container
   * @returns {Promise<string>} The document key
   *
   * @example
   * const key = await searchService.addDocument({ title: 'Test', content: 'Sample' });
   * console.log(key);
   */
  searchService.prototype.addDocument = function(document, key, container) {
    if (this.provider === 'remote') {
      return this._remoteAddDocument(document, key, container);
    } else {
      return this._localAddDocument(document, key, container);
    }
  };

  /**
   * Add document to remote server
   *
   * @private
   * @async
   */
  searchService.prototype._remoteAddDocument = function(document, key, container) {
    const self = this;
    return new Promise(function(resolve, reject) {
      const searchContainer = container || self.searchContainer || '';
      let url = self.baseUrl + '/add';

      if (searchContainer) {
        url += '?searchContainer=' + encodeURIComponent(searchContainer);
      }

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(document)
      })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Add document failed with status ' + response.status);
          }
          resolve(key || '');
        })
        .catch(function(error) {
          console.error('Remote add document error:', error);
          reject(error);
        });
    });
  };

  /**
   * Add document to local client-side index
   *
   * @private
   * @async
   */
  searchService.prototype._localAddDocument = function(document, key, container) {
    const self = this;
    return new Promise(function(resolve) {
      const docKey = key || 'doc-' + (++self.documentCounter);

      // Store the document
      self.documentStore.set(docKey, {
        ...document,
        _key: docKey
      });

      // Update indexes
      for (let field in document) {
        if (document.hasOwnProperty(field) && typeof document[field] === 'string') {
          const value = document[field].toLowerCase();
          if (!self.localIndex.has(field)) {
            self.localIndex.set(field, new Map());
          }
          const fieldIndex = self.localIndex.get(field);
          if (!fieldIndex.has(value)) {
            fieldIndex.set(value, []);
          }
          fieldIndex.get(value).push(docKey);
        }
      }

      resolve(docKey);
    });
  };

  /**
   * Delete a document from the search index
   *
   * @async
   * @param {string} key - The document key to delete
   * @param {string} [container] - Optional search container
   * @returns {Promise<boolean>} True if deleted successfully
   *
   * @example
   * const result = await searchService.deleteDocument('doc-1');
   * console.log(result);
   */
  searchService.prototype.deleteDocument = function(key, container) {
    if (this.provider === 'remote') {
      return this._remoteDeleteDocument(key, container);
    } else {
      return this._localDeleteDocument(key, container);
    }
  };

  /**
   * Delete document from remote server
   *
   * @private
   * @async
   */
  searchService.prototype._remoteDeleteDocument = function(key, container) {
    const self = this;
    return new Promise(function(resolve, reject) {
      const searchContainer = container || self.searchContainer || '';
      let url = self.baseUrl + '/delete/' + encodeURIComponent(key);

      if (searchContainer) {
        url += '?searchContainer=' + encodeURIComponent(searchContainer);
      }

      fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Delete failed with status ' + response.status);
          }
          resolve(true);
        })
        .catch(function(error) {
          console.error('Remote delete error:', error);
          reject(error);
        });
    });
  };

  /**
   * Delete document from local client-side index
   *
   * @private
   * @async
   */
  searchService.prototype._localDeleteDocument = function(key, container) {
    const self = this;
    return new Promise(function(resolve) {
      const existed = self.documentStore.has(key);

      if (existed) {
        const doc = self.documentStore.get(key);
        self.documentStore.delete(key);

        // Remove from indexes
        for (let field in doc) {
          if (doc.hasOwnProperty(field) && field !== '_key') {
            const value = doc[field].toString().toLowerCase();
            if (self.localIndex.has(field)) {
              const fieldIndex = self.localIndex.get(field);
              if (fieldIndex.has(value)) {
                const keys = fieldIndex.get(value);
                const idx = keys.indexOf(key);
                if (idx > -1) {
                  keys.splice(idx, 1);
                }
              }
            }
          }
        }
      }

      resolve(existed);
    });
  };

  /**
   * Get suggestions for a search term
   * Useful for autocomplete functionality
   *
   * @async
   * @param {string} term - Partial search term
   * @param {number} [limit] - Maximum number of suggestions (default: 10)
   * @returns {Promise<Array<string>>} Array of suggestion terms
   *
   * @example
   * const suggestions = await searchService.getSuggestions('app');
   * console.log(suggestions);
   */
  searchService.prototype.getSuggestions = function(term, limit) {
    const self = this;
    limit = limit || 10;

    if (this.provider === 'remote') {
      return this._remoteGetSuggestions(term, limit);
    } else {
      return this._localGetSuggestions(term, limit);
    }
  };

  /**
   * Get local suggestions
   *
   * @private
   * @async
   */
  searchService.prototype._localGetSuggestions = function(term, limit) {
    const self = this;
    return new Promise(function(resolve) {
      const suggestions = new Set();
      const searchTerm = term.toLowerCase();

      // Get suggestions from all indexed documents
      self.documentStore.forEach(function(doc) {
        for (let field in doc) {
          if (doc.hasOwnProperty(field) && typeof doc[field] === 'string') {
            const value = doc[field].toLowerCase();
            if (value.includes(searchTerm)) {
              suggestions.add(value);
            }
          }
        }
      });

      // Convert to array and limit results
      resolve(Array.from(suggestions).slice(0, limit));
    });
  };

  /**
   * Remote get suggestions
   *
   * @private
   * @async
   */
  searchService.prototype._remoteGetSuggestions = function(term, limit) {
    const self = this;
    return new Promise(function(resolve, reject) {
      // For remote, we can do a search with limit
      let url = self.baseUrl + '/search/' + encodeURIComponent(term);

      fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Get suggestions failed');
          }
          return response.json();
        })
        .then(function(data) {
          // Extract unique values from results
          const suggestions = new Set();
          if (Array.isArray(data)) {
            data.slice(0, limit).forEach(function(item) {
              if (typeof item === 'object') {
                for (let key in item) {
                  if (typeof item[key] === 'string') {
                    suggestions.add(item[key]);
                  }
                }
              }
            });
          }
          resolve(Array.from(suggestions));
        })
        .catch(function(error) {
          console.error('Remote get suggestions error:', error);
          reject(error);
        });
    });
  };

  /**
   * Clear all documents in the index
   *
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * await searchService.clear();
   */
  searchService.prototype.clear = function() {
    const self = this;
    return new Promise(function(resolve) {
      self.documentStore.clear();
      self.localIndex.clear();
      self.documentCounter = 0;
      resolve();
    });
  };

  /**
   * Get the number of documents in the index
   *
   * @returns {number} Document count
   *
   * @example
   * console.log(searchService.getDocumentCount());
   */
  searchService.prototype.getDocumentCount = function() {
    return this.documentStore.size;
  };

  // Export to global scope
  global.searchService = searchService;

  // Also export as alias for backward compatibility
  if (!global.nooblyjsSearching) {
    global.nooblyjsSearching = searchService;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
