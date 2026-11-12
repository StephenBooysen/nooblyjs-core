/**
 * @fileoverview Knowledge service factory (feature 05): question answering
 * over a filing source, with citations and incremental sync.
 *
 * The filing, searching and AI instances are passed in options, because the
 * app chooses them (`filing`, `search`, `ai`); the registry injects only
 * logging.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.11
 */

'use strict';

const KnowledgeService = require('./providers/knowledge');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a knowledge service.
 *
 * @param {string} type Provider type: 'default'
 * @param {Object} options See KnowledgeService for the options.
 * @param {EventEmitter} eventEmitter Shared event bus.
 * @return {KnowledgeService}
 * @throws {Error} For an unknown provider type, or when no searching instance is given.
 * @example
 * const kb = serviceRegistry.knowledge('default', { filing, search, ai, source: { path: 'docs' } });
 */
function createKnowledgeService(type, options, eventEmitter) {
  let service;
  switch (type) {
    case 'default':
    case undefined:
      service = new KnowledgeService(options, eventEmitter);
      break;
    default:
      throw new Error(`Unknown knowledge provider "${type}". Use "default".`);
  }
  Routes(options, eventEmitter, service);
  Views(options, eventEmitter, service);
  return service;
}

module.exports = createKnowledgeService;
