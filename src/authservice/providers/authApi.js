/**
 * @fileoverview API-based authentication implementation that proxies requests to a remote auth service.
 * Allows client applications to consume backend authentication API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements authentication operations via HTTP API calls to a remote service.
 * Provides methods for user registration, login, and management through REST endpoints.
 * @class
 */
class AuthApi {
  /**
   * Initializes the Auth API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 10000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {

    this.settings = {};
    this.settings.desciption = "This provider exposes the NooblyJS distributed implementation settings"
    this.settings.list = [
      {setting: "apiroot", type: "string", values : ['http://localhost:3000']} ,
      {setting: "apikey", type: "string", values : ['The api key retrieved fron from your adminstrator']} ,
      {setting: "timeout", type: "int", values : ['1000']} 
    ]

    this.apiRoot = options.apiRoot || this.settings.apiroot || 'http://localhost:3000';
    this.apiKey = options.apiKey || this.settings.apikey || null;
    this.timeout = options.timeout || this.settings.timeout || 10000;

    this.eventEmitter_ = eventEmitter;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });
  }

  /**
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i=0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting]
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:setting-changed', {
            setting: this.settings.list[i].setting,
            value: settings[this.settings.list[i].setting]
          });
        }
      }
    }
  }

  /**
   * Registers a new user via the remote auth API.
   * @param {Object} userData User registration data.
   * @return {Promise<Object>} A promise that resolves to the created user.
   */
  async register(userData) {
    try {
      const response = await this.client.post('/services/authservice/api/register', userData);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:register', { user: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'register', error: error.message });
      throw error;
    }
  }

  /**
   * Authenticates a user via the remote auth API.
   * @param {Object} credentials User login credentials.
   * @return {Promise<Object>} A promise that resolves to the authenticated user and token.
   */
  async login(credentials) {
    try {
      const response = await this.client.post('/services/authservice/api/login', credentials);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:login', { user: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:error', { operation: 'login', error: error.message });
        this.eventEmitter_.emit('auth:login-failed', {
          email: credentials && credentials.email,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Validates a token via the remote auth API.
   * @param {string} token The token to validate.
   * @return {Promise<Object>} A promise that resolves to the token validation result.
   */
  async validateToken(token) {
    try {
      const response = await this.client.post('/services/authservice/api/validate', { token });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'validateToken', error: error.message });
      throw error;
    }
  }

  /**
   * Gets a user by ID via the remote auth API.
   * @param {string} userId The user ID.
   * @return {Promise<Object>} A promise that resolves to the user data.
   */
  async getUser(userId) {
    try {
      const response = await this.client.get(`/services/authservice/api/user/${userId}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'getUser', error: error.message });
      throw error;
    }
  }

  /**
   * Updates a user via the remote auth API.
   * @param {string} userId The user ID.
   * @param {Object} updates The user data to update.
   * @return {Promise<Object>} A promise that resolves to the updated user.
   */
  async updateUser(userId, updates) {
    try {
      const response = await this.client.put(`/services/authservice/api/user/${userId}`, updates);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:update', { userId, updates });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'updateUser', error: error.message });
      throw error;
    }
  }

  /**
   * Deletes a user via the remote auth API.
   * @param {string} userId The user ID.
   * @return {Promise<void>} A promise that resolves when the user is deleted.
   */
  async deleteUser(userId) {
    try {
      await this.client.delete(`/services/authservice/api/user/${userId}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:delete', { userId });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'deleteUser', error: error.message });
      throw error;
    }
  }

  /**
   * Lists all users via the remote auth API.
   * @return {Promise<Array>} A promise that resolves to the list of users.
   */
  async listUsers() {
    try {
      const response = await this.client.get('/services/authservice/api/users');
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('auth:error', { operation: 'listUsers', error: error.message });
      throw error;
    }
  }
}

module.exports = AuthApi;
