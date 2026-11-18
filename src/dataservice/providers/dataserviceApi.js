/**
 * @fileoverview API-based data service implementation that proxies requests to a remote data service.
 * Allows client applications to consume backend data API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements data operations via HTTP API calls to a remote service.
 * Provides CRUD methods for data management through REST endpoints.
 * @class
 */
class DataServiceApi {
  /**
   * Initializes the Data Service API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 10000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for data events.
   */
  constructor(options = {}, eventEmitter) {

    this.settings = {};
    this.settings.description = "Configuration settings for the DataService API Provider";
    this.settings.list = [
      {setting: "apiUrl", type: "string", values: ["http://localhost:3000"]},
      {setting: "timeout", type: "number", values: [10000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
     this.settings.api = options.api || 'http://localhost:3000';
     this.settings.apikey = options.apiKey || null;
     this.timeout = options.timeout || 5000;

     this.eventEmitter_ = eventEmitter;
 
     // Configure axios instance
     this.client = axios.create({
       baseURL: this.settings.api,
       timeout: this.timeout,
       headers: this.settings.apikey ? { 'X-API-Key': this.settings.apikey } : {}
     });
  }

  /**
   * Creates a new record in the remote data service.
   * Sends a POST request to create a new document/record in the specified collection.
   * The server assigns an ID to the new record and returns the complete record object.
   *
   * @param {string} collection The name of the collection/table where the record will be created
   * @param {Object} data The record data to create. Can contain any fields relevant to the entity.
   * @return {Promise<Object>} A promise that resolves to the created record object including its assigned ID
   * @throws {Error} When the HTTP request fails or the collection does not exist
   *
   * @example
   * // Create a new user record
   * const newUser = await dataService.create('users', {
   *   name: 'Alice Johnson',
   *   email: 'alice@example.com',
   *   role: 'admin'
   * });
   * console.log(`User created with ID: ${newUser.id}`);
   */
  async create(collection, data) {
    try {
      const response = await this.client.post(`/services/dataservice/api/${collection}`, data);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:create', { collection, data: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'create', collection, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all or filtered records from the remote data service.
   * Sends a GET request to fetch multiple records from the specified collection.
   * Supports optional query parameters for filtering, sorting, and pagination.
   *
   * @param {string} collection The name of the collection/table to query
   * @param {Object} [query] Optional query parameters including:
   *   - filter: {Object} Field-value pairs to filter records
   *   - sort: {string} Field name to sort by (prefix with '-' for descending)
   *   - skip: {number} Number of records to skip for pagination
   *   - limit: {number} Maximum number of records to return
   * @return {Promise<Array>} A promise that resolves to an array of matching record objects
   * @throws {Error} When the HTTP request fails or the collection does not exist
   *
   * @example
   * // Get all users
   * const allUsers = await dataService.read('users');
   *
   * @example
   * // Get users with filtering and pagination
   * const activeUsers = await dataService.read('users', {
   *   filter: { status: 'active' },
   *   sort: '-createdAt',
   *   skip: 0,
   *   limit: 20
   * });
   */
  async read(collection, query = {}) {
    try {
      const response = await this.client.get(`/services/dataservice/api/${collection}`, { params: query });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:read', { collection, count: response.data.length });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'read', collection, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves a single record by its ID from the remote data service.
   * Sends a GET request to fetch a specific record by its unique identifier.
   * Returns null or throws an error if the record is not found, depending on server configuration.
   *
   * @param {string} collection The name of the collection/table
   * @param {string} id The unique identifier of the record to retrieve
   * @return {Promise<Object>} A promise that resolves to the record object
   * @throws {Error} When the HTTP request fails, the collection does not exist, or the record is not found
   *
   * @example
   * // Get a specific user by ID
   * const user = await dataService.readById('users', 'user-123');
   * console.log(`User name: ${user.name}`);
   */
  async readById(collection, id) {
    try {
      const response = await this.client.get(`/services/dataservice/api/${collection}/${id}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:readById', { collection, id });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'readById', collection, id, error: error.message });
      throw error;
    }
  }

  /**
   * Updates an existing record in the remote data service.
   * Sends a PUT request to update specific fields of a record. Performs a merge operation:
   * provided fields are updated while unspecified fields remain unchanged.
   *
   * @param {string} collection The name of the collection/table
   * @param {string} id The unique identifier of the record to update
   * @param {Object} updates An object containing only the fields to update. Other fields are preserved.
   * @return {Promise<Object>} A promise that resolves to the updated record object
   * @throws {Error} When the HTTP request fails, the collection or record does not exist
   *
   * @example
   * // Update a user's status
   * const updated = await dataService.update('users', 'user-123', {
   *   status: 'inactive',
   *   lastModified: new Date().toISOString()
   * });
   */
  async update(collection, id, updates) {
    try {
      const response = await this.client.put(`/services/dataservice/api/${collection}/${id}`, updates);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:update', { collection, id, updates });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'update', collection, id, error: error.message });
      throw error;
    }
  }

  /**
   * Deletes a record from the remote data service.
   * Sends a DELETE request to permanently remove a record from the collection.
   * The operation is idempotent: deleting a non-existent record does not cause an error.
   *
   * @param {string} collection The name of the collection/table
   * @param {string} id The unique identifier of the record to delete
   * @return {Promise<void>} A promise that resolves when the record is successfully deleted
   * @throws {Error} When the HTTP request fails or the collection does not exist
   *
   * @example
   * // Delete a user
   * await dataService.delete('users', 'user-123');
   * console.log('User deleted successfully');
   */
  async delete(collection, id) {
    try {
      await this.client.delete(`/services/dataservice/api/${collection}/${id}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:delete', { collection, id });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'delete', collection, id, error: error.message });
      throw error;
    }
  }

  /**
   * Executes a complex query against the remote data service.
   * Sends a POST request to perform advanced queries with multiple conditions, nested filters,
   * and complex matching logic beyond simple field filtering.
   *
   * @param {string} collection The name of the collection/table
   * @param {Object} query The query object with conditions. Format depends on the backend query language.
   *   Typically supports: { field: value }, { $gt: value }, { $in: [values] }, etc.
   * @return {Promise<Array>} A promise that resolves to an array of matching records
   * @throws {Error} When the HTTP request fails, the collection does not exist, or the query is invalid
   *
   * @example
   * // Query for users with age > 18 and active status
   * const adults = await dataService.query('users', {
   *   age: { $gt: 18 },
   *   status: 'active'
   * });
   */
  async query(collection, query) {
    try {
      const response = await this.client.post(`/services/dataservice/api/${collection}/query`, { query });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:query', { collection, count: response.data.length });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('data:error', { operation: 'query', collection, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all current configuration settings for the data service API provider.
   * Returns the settings object including API URL, timeout, and retry limit configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - apiUrl: {string} The remote API URL
   *   - timeout: {number} Request timeout in milliseconds
   *   - retryLimit: {number} Maximum number of retry attempts
   *
   * @example
   * const settings = await dataService.getSettings();
   * console.log(`API Timeout: ${settings.timeout}ms`);
   */
  // ============================================================
  // Standard DataService Interface Adapters
  // These methods adapt the API provider to the standard interface
  // expected by the factory and service wrapper.
  // ============================================================

  /**
   * Creates a container. No-op for API provider (server manages containers).
   * @param {string} containerName The container name.
   * @return {Promise<void>}
   */
  async createContainer(containerName) {
    // Remote API manages containers implicitly
  }

  /**
   * Adds a JSON object to the specified container via API.
   * @param {string} containerName The container name.
   * @param {!Object} jsonObject The object to store.
   * @return {Promise<string>} The UUID of the created object.
   */
  async add(containerName, jsonObject) {
    const result = await this.create(containerName, jsonObject);
    return result.id || result.uuid || result._id;
  }

  /**
   * Removes an object by UUID via API.
   * @param {string} containerName The container name.
   * @param {string} objectKey The UUID of the object.
   * @return {Promise<boolean>} True if removed.
   */
  async remove(containerName, objectKey) {
    try {
      await this.delete(containerName, objectKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Retrieves an object by UUID via API.
   * @param {string} containerName The container name.
   * @param {string} objectKey The UUID.
   * @return {Promise<Object|null>} The object or null.
   */
  async getByUuid(containerName, objectKey) {
    try {
      return await this.readById(containerName, objectKey);
    } catch (err) {
      return null;
    }
  }

  /**
   * Searches for objects in a container via API.
   * @param {string} containerName The container name.
   * @param {string} searchTerm Search term (empty returns all).
   * @return {Promise<Array>} Matching objects.
   */
  async find(containerName, searchTerm = '') {
    try {
      const params = searchTerm ? { q: searchTerm } : {};
      const response = await this.client.get(`/services/dataservice/api/find/${containerName}`, { params });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('api-dataservice-find', { containerName, searchTerm, results: response.data });
      return response.data;
    } catch (err) {
      return [];
    }
  }

  /**
   * Lists all objects in a container.
   * @param {string} containerName The container name.
   * @return {Promise<Array>} All objects.
   */
  async listAll(containerName) {
    return this.find(containerName, '');
  }

  /**
   * Counts objects in a container.
   * @param {string} containerName The container name.
   * @return {Promise<number>} The count.
   */
  async count(containerName) {
    const all = await this.listAll(containerName);
    return all.length;
  }

  /**
   * Closes the API provider (no-op).
   * @return {Promise<void>}
   */
  async close() {
    // No-op for API provider
  }

  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the data service API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   * Emits structured logging for audit trails.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.apiUrl] The new remote API URL
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @param {number} [settings.retryLimit] The new retry limit
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update API timeout
   * await dataService.saveSettings({
   *   timeout: 15000,
   *   apiUrl: 'https://data-api.internal.service'
   * });
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
  }
}

module.exports = DataServiceApi;
