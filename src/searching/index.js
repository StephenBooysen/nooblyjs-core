/**
 * @fileoverview Factory for the Search service.
 */
// TODO I broke this so need to fix

const SearchService = require('./provider/searching.js');
const Routes = require('./routes');

/**
 * Creates a SearchService instance.
 * @param {string} type. The type of search service to return
 * @param {object} options. The options object send to the underlying providers
 * @param {EventEmitter=} eventEmitter Optional EventEmitter instance for event bubbling.
 * @return {!SearchService} A SearchService instance.
 */
function createSearchService(type, options, eventEmitter) {
  eventEmitter.emit("Search Service Intantiated", {});
  var searching = new SearchService(options,eventEmitter);
  Routes(options, eventEmitter, searching);
  return searching;
}

module.exports = createSearchService;
