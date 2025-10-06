/**
 * @fileoverview Search Service Factory
 * Factory module for creating search service instances.
 * Provides full-text search, indexing, and query capabilities.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';
const SearchService = require('./provider/searching.js');
const SearchingApi = require('./providers/searchingApi');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a search service instance with indexing and query capabilities.
 * Automatically configures routes and views for the search service.
 * @param {string} type - The search service type ('default', 'api')
 * @param {Object} options - Configuration options for the search service
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {SearchService|SearchingApi} Search service instance for indexing and querying
 */
function createSearchService(type, options, eventEmitter) {
  // Emit service instantiation event
  eventEmitter.emit('Search Service Instantiated', {});

  // Create search service instance
  let searching;

  switch (type) {
    case 'api':
      searching = new SearchingApi(options, eventEmitter);
      break;
    case 'default':
    default:
      searching = new SearchService(options, eventEmitter);
      break;
  }
  
  // Initialize routes and views for the search service
  Routes(options, eventEmitter, searching);
  Views(options, eventEmitter, searching);
  
  return searching;
}

module.exports = createSearchService;
