/**
 * @fileoverview API-based filing service implementation that proxies requests to a remote filing service.
 * Allows client applications to consume backend filing API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');
const { applyRuntimeSettings, numberRule } = require('../modules/settingsPolicy');

/** Settings that may change while the service runs. The remote URL is fixed (SSRF guard). */
const RUNTIME_RULES = {
  timeout: numberRule('timeout', { min: 1000, max: 600000, integer: true }),
  retryLimit: numberRule('retryLimit', { min: 0, max: 10, integer: true })
};


/**
 * A class that implements file operations via HTTP API calls to a remote service.
 * Provides methods for file storage, retrieval, and management through REST endpoints.
 * @class
 */
class FilingApi {
  /**
   * Initializes the Filing API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 30000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for filing events.
   */
  constructor(options = {}, eventEmitter) {
    this.apiRoot = options.apiRoot || 'http://localhost:3000';
    this.apiKey = options.apiKey || null;
    this.timeout = options.timeout || 30000;
    this.eventEmitter_ = eventEmitter;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    // Settings for filing API provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Filing API Provider";
    this.settings.list = [
      {setting: "timeout", type: "number", values: [30000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.apiUrl = options.apiUrl || 'http://localhost:3000';
    this.settings.timeout = options.timeout || 30000;
    this.settings.retryLimit = options.retryLimit || 3;
  }

  /**
   * Uploads a file via the remote filing API.
   * @param {string} path The file path.
   * @param {Buffer|string} data The file data.
   * @param {Object=} options Upload options.
   * @return {Promise<Object>} A promise that resolves to the upload result.
   */
  async upload(path, data, options = {}) {
    try {
      const response = await this.client.post('/services/filing/api/upload', { path, data, options });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:upload', { path, size: data.length });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:error', { operation: 'upload', path, error: error.message });
      throw error;
    }
  }

  /**
   * Downloads a file via the remote filing API.
   * @param {string} path The file path.
   * @return {Promise<Buffer>} A promise that resolves to the file data.
   */
  async download(path) {
    try {
      const response = await this.client.get(`/services/filing/api/download/${encodeURIComponent(path)}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:download', { path });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:error', { operation: 'download', path, error: error.message });
      throw error;
    }
  }

  /**
   * Deletes a file via the remote filing API.
   * @param {string} path The file path.
   * @return {Promise<void>} A promise that resolves when the file is deleted.
   */
  async delete(path) {
    try {
      await this.client.delete(`/services/filing/api/delete/${encodeURIComponent(path)}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:delete', { path });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:error', { operation: 'delete', path, error: error.message });
      throw error;
    }
  }

  /**
   * Lists files via the remote filing API.
   * @param {string=} directory The directory path.
   * @return {Promise<Array>} A promise that resolves to the file list.
   */
  async list(directory = '/') {
    try {
      const response = await this.client.get('/services/filing/api/list', { params: { directory } });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:list', { directory, count: response.data.length });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:error', { operation: 'list', directory, error: error.message });
      throw error;
    }
  }

  /**
   * Gets file metadata via the remote filing API.
   * @param {string} path The file path.
   * @return {Promise<Object>} A promise that resolves to the file metadata.
   */
  async getMetadata(path) {
    try {
      const response = await this.client.get(`/services/filing/api/metadata/${encodeURIComponent(path)}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:error', { operation: 'getMetadata', path, error: error.message });
      throw error;
    }
  }

  /**
   * Get all settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Save/update settings
   */
  async saveSettings(settings){
    const updates = applyRuntimeSettings(settings, {
      rules: RUNTIME_RULES,
      fixed: { apiUrl: this.settings.apiUrl }
    });
    for (const [setting, newValue] of Object.entries(updates)) {
      this.settings[setting] = newValue;
      this.logger?.info(`[${this.constructor.name}] Setting changed`, {
        setting,
        newValue,
        operation: 'saveSettings'
      });
    }
  }
}

module.exports = FilingApi;
