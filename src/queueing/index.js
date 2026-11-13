/**
 * @fileoverview Queue Service Factory
 * Factory module for creating queue service instances.
 * Provides message queuing, task scheduling, and job management capabilities.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Queueing = require('./providers/queueing');
const QueueingRedis = require('./providers/queueingRedis');
const QueueingRabbitMQ = require('./providers/queueingRabbitMQ');
const QueueingActiveMQ = require('./providers/queueingActiveMQ');
const QueueingApi = require('./providers/queueingApi');
const QueueAnalytics = require('./modules/analytics');
const { ReliableJobs } = require('./modules/reliableJobs');
const { attachReliableJobs, attachUnsupportedJobs } = require('./modules/reliableJobs');
const { MemoryJobStore } = require('./modules/memoryJobStore');
const { createRedisJobStore } = require('./modules/redisJobStore');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a queue service instance with the specified provider and dependency injection.
 * Automatically configures routes and views for the queue service.
 * @param {string} type - The queue provider type ('memory', 'redis', 'rabbitmq', 'activemq', 'api', 'aws', 'azure', 'gcp')
 * @param {Object} options - Configuration options for the queue service
 * @param {string} [options.instanceName='default'] - Unique identifier for this queue instance
 * @param {string} [options.host] - Redis/RabbitMQ host (for redis/rabbitmq providers)
 * @param {number} [options.port] - Redis/RabbitMQ port (for redis/rabbitmq providers)
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {Object} options.dependencies.caching - Caching service instance
 * @param {Object} options.dependencies.dataservice - DataService service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {Queueing|QueueingRedis|QueueingRabbitMQ|QueueingActiveMQ|QueueingApi} Queue service instance with specified provider
 * @throws {Error} When unsupported queue type is provided
 * @example
 * const queueService = createQueue('memory', {
 *   instanceName: 'task-queue',
 *   dependencies: { logging, caching, dataservice }
 * }, eventEmitter);
 *
 * // Enqueue a task
 * await queueService.enqueue('process-order', { orderId: 123, userId: 456 });
 *
 * // Dequeue and process tasks
 * const task = await queueService.dequeue('process-order');
 * if (task) {
 *   console.log('Processing task:', task);
 *   // Process the task...
 * }
 *
 * // Get queue size
 * const size = await queueService.size('process-order');
 * console.log(`Queue size: ${size}`);
 */
function createQueue(type, options, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;
  const cache = dependencies.caching;
  const dataStore = dependencies.dataservice;

  let queue;

  // Create queue instance based on provider type
  switch (type) {
    case 'rabbitmq':
      queue = new QueueingRabbitMQ(providerOptions, eventEmitter);
      break;
    case 'activemq':
      queue = new QueueingActiveMQ(providerOptions, eventEmitter);
      break;
    case 'redis':
      queue = new QueueingRedis(providerOptions, eventEmitter);
      break;
    case 'api':
      queue = new QueueingApi(providerOptions, eventEmitter);
      break;
    case 'aws': {
      const QueueingAWS = require('./providers/queueingAWS');
      queue = new QueueingAWS(providerOptions, eventEmitter);
      break;
    }
    case 'azure': {
      const QueueingAzure = require('./providers/queueingAzure');
      queue = new QueueingAzure(providerOptions, eventEmitter);
      break;
    }
    case 'gcp': {
      const QueueingGCP = require('./providers/queueingGCP');
      queue = new QueueingGCP(providerOptions, eventEmitter);
      break;
    }
    case 'memory':
    default:
      queue = new Queueing(providerOptions, eventEmitter);
      break;
  }

  // Inject dependencies into queue service
  if (logger) {
    queue.logger = logger;
    queue.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[QUEUE:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    // Log queue service initialization
    queue.log('info', 'Queue service initialized', {
      provider: type,
      hasLogging: true,
      hasCaching: !!cache,
      hasDataStore: !!dataStore
    });
  }

  // Inject caching dependency for performance optimizations
  if (cache) {
    queue.cache = cache;
  }

  // Inject datastore dependency for persistence
  if (dataStore) {
    queue.dataStore = dataStore;
  }

  // Store all dependencies for potential use by provider
  queue.dependencies = dependencies;

  // Reliable jobs (feature 06): memory and Redis keep jobs in their own store;
  // other providers refuse reliable options with a clear error.
  if (type === 'memory') {
    attachReliableJobs(queue, new ReliableJobs(new MemoryJobStore()));
  } else if (type === 'redis') {
    const store = createRedisJobStore(queue.client_, { ensure: () => queue.ensureConnection_() });
    attachReliableJobs(queue, new ReliableJobs(store), {
      validateQueueName: (name, method) => queue.validateQueueName_(name, method)
    });
  } else {
    attachUnsupportedJobs(queue, type);
  }

  // Initialize analytics module
  if (eventEmitter) {
    const instanceName = (providerOptions && providerOptions.instanceName) || 'default';
    queue.analytics = new QueueAnalytics(eventEmitter, instanceName);

    if (logger) {
      queue.log('info', 'Queue analytics initialized', {
        provider: type,
        instance: instanceName
      });
    }
  }

  // Initialize routes and views for the queue service
  Routes(options, eventEmitter, queue);
  Views(options, eventEmitter, queue);

  return queue;
}

module.exports = createQueue;
