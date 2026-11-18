/**
 * @fileoverview NooblyJS Core - Data Layer Base Class
 * Base class for implementing custom data layer logic in NooblyJS Core.
 * Provides integration with the dataservice for persistent storage operations.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const appBase = require('./appBase.js');

/**
 * Base class for custom data layer implementations.
 * Extends appBase to provide data-specific functionality for working with persistent storage.
 * Use this when implementing custom data access logic, data models, or database interactions.
 *
 * Data classes can leverage the injected dataservice to perform CRUD operations
 * while providing application-specific data layer abstractions.
 *
 * @class appDataBase
 * @extends {appBase}
 */
class appDataBase extends appBase {

  /**
   * Creates a new appDataBase instance.
   *
   * @param {string} type - The data layer type identifier (e.g., 'user-repository', 'order-store')
   * @param {Object} options - Data layer configuration options
   * @param {Express} options['express-app'] - Express application instance
   * @param {Object} [options.dependencies] - Injected service dependencies (dataservice, logging, etc.)
   * @param {string} [options.containerName='default'] - Name of the data container/table/collection
   * @param {string} [options.instanceName='default'] - Unique identifier for this data layer instance
   * @param {Object} [options.schema] - Optional data schema/model definition
   * @param {EventEmitter} eventEmitter - Global event emitter for data operation communication
   *
   * @example
   * // Creating a custom data repository that extends appDataBase
   * class UserRepository extends appDataBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *     this.containerName = options.containerName || 'users';
   *   }
   *
   *   async createUser(userData) {
   *     const user = {
   *       id: this.generateId(),
   *       ...userData,
   *       createdAt: new Date()
   *     };
   *     // Use injected dataservice to persist data
   *     await this.options.dependencies.dataservice.create(
   *       this.containerName,
   *       user.id,
   *       user
   *     );
   *     return user;
   *   }
   *
   *   async getUserById(userId) {
   *     return await this.options.dependencies.dataservice.get(
   *       this.containerName,
   *       userId
   *     );
   *   }
   *
   *   async updateUser(userId, updates) {
   *     const user = await this.getUserById(userId);
   *     const updated = { ...user, ...updates };
   *     await this.options.dependencies.dataservice.update(
   *       this.containerName,
   *       userId,
   *       updated
   *     );
   *     return updated;
   *   }
   *
   *   async deleteUser(userId) {
   *     return await this.options.dependencies.dataservice.delete(
   *       this.containerName,
   *       userId
   *     );
   *   }
   *
   *   generateId() {
   *     return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
   *   }
   * }
   *
   * @example
   * // Using the custom data repository
   * const userRepository = new UserRepository('user-repository', {
   *   'express-app': app,
   *   containerName: 'users',
   *   dependencies: { dataservice, logging }
   * }, eventEmitter);
   *
   * // Now you can use the repository for data operations
   * const newUser = await userRepository.createUser({
   *   name: 'John Doe',
   *   email: 'john@example.com'
   * });
   */
  constructor(type, options, eventEmitter) {
    super(type, options, eventEmitter);

    /**
     * Name of the data container (table, collection, or similar)
     * Used when accessing the dataservice for persistence operations
     * @type {string}
     * @protected
     */
    this.containerName = options.containerName || 'default';

    /**
     * Optional data schema or model definition
     * @type {Object|undefined}
     * @protected
     */
    this.schema = options.schema;
  }

  /**
   * Gets the injected dataservice instance for performing data operations.
   * Provides convenient access to the dataservice for subclasses.
   *
   * @return {Object|undefined} The dataservice instance from dependencies
   * @protected
   *
   * @example
   * const dataService = this.getDataService();
   * const user = await dataService.get('users', userId);
   */
  getDataService() {
    return this.options?.dependencies?.dataservice;
  }

  /**
   * Gets the injected logging service instance.
   * Provides convenient access to the logger for subclasses.
   *
   * @return {Object|undefined} The logging service instance from dependencies
   * @protected
   *
   * @example
   * const logger = this.getLogger();
   * logger?.info('Data operation completed');
   */
  getLogger() {
    return this.options?.dependencies?.logging;
  }
}

module.exports = appDataBase;