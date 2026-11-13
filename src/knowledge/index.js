/**
 * @fileoverview Knowledge service factory (feature 05): answers questions from a
 * filing source with citations. The only provider is `default`, which is built
 * from the filing, vector search and AI services it is given.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { KnowledgeBase } = require('./providers/knowledge');
const Routes = require('./routes');

/**
 * Creates a knowledge service.
 *
 * @param {string} type Provider type, only 'default' is supported
 * @param {Object} options Provider options: container, extensions, maxChunkChars, overlapChars, topK, and dependencies
 * @param {Object} [options.dependencies] Injected services: filing, searching (vector), aiservice, logging
 * @param {EventEmitter} eventEmitter Shared event emitter
 * @return {KnowledgeBase} The knowledge base, with routes mounted when an express app is given
 * @throws {Error} For an unknown provider or missing dependencies
 */
function createKnowledgeService(type, options = {}, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;
  if (type !== 'default') {
    throw new Error(`Unsupported knowledge provider type: ${type}`);
  }
  const service = new KnowledgeBase({
    filing: dependencies.filing,
    searching: dependencies.searching,
    aiservice: dependencies.aiservice,
    logger: dependencies.logging
  }, providerOptions, eventEmitter);
  service.dependencies = dependencies;
  Routes(options, eventEmitter, service);
  return service;
}

module.exports = createKnowledgeService;
