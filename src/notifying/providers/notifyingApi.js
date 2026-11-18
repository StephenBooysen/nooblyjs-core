/**
 * @fileoverview API-based notifying service implementation that proxies requests to a remote notifying service.
 * Allows client applications to consume backend notification API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements notification operations via HTTP API calls to a remote service.
 * Provides methods for sending notifications through various channels via REST endpoints.
 * @class
 */
class NotifyingApi {
  /**
   * Initializes the Notifying API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 10000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for notifying events.
   */
  constructor(options = {}, eventEmitter) {
    this.apiRoot = options.apiRoot || options.api || 'http://localhost:3000';
    this.apiKey = options.apiKey || null;
    this.timeout = options.timeout || 10000;
    this.eventEmitter_ = eventEmitter;

    // Initialize logger from dependencies
    const { dependencies = {} } = options;
    /** @private */
    this.logger = dependencies.logging || null;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    // Settings for notifying API provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Notifying API Provider";
    this.settings.list = [
      {setting: "url", type: "string", values: ["http://localhost:3000"]},
      {setting: "timeout", type: "number", values: [10000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.url = this.apiRoot;
    this.settings.timeout = this.timeout;
    this.settings.retryLimit = options.retryLimit || this.settings.list[2].values[0];
  }

  /**
   * Sends a notification via the remote notifying service.
   * Core method for delivering notifications across multiple channels.
   * Supports flexible notification payloads with channel-specific configuration.
   *
   * @param {Object} notification The notification object containing:
   *   - channel: {string} Delivery channel: 'email', 'sms', 'push', 'slack', 'webhook', etc.
   *   - recipient: {string} Recipient identifier (email address, phone number, user ID, URL, etc.)
   *   - subject: {string} Notification subject or title
   *   - message: {string} Notification body/content
   *   - options: {Object} Channel-specific options (priority, retry, delay, etc.)
   * @return {Promise<Object>} A promise that resolves to the notification result containing:
   *   - notificationId: {string} Unique notification identifier for tracking
   *   - channel: {string} Channel used for delivery
   *   - status: {string} Delivery status ('sent', 'queued', 'failed')
   *   - timestamp: {string} ISO timestamp of sending
   * @throws {Error} When the HTTP request fails or notification parameters are invalid
   *
   * @example
   * // Send a generic notification
   * await notifyingApi.send({
   *   channel: 'email',
   *   recipient: 'user@example.com',
   *   subject: 'Password Reset',
   *   message: 'Please click the link to reset your password...',
   *   options: { priority: 'high', retries: 3 }
   * });
   */
  async send(notification) {
    try {
      const response = await this.client.post('/services/notifying/api/send', notification);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('notifying:send', { channel: notification.channel, recipient: notification.recipient });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('notifying:error', { operation: 'send', error: error.message });
      throw error;
    }
  }

  /**
   * Sends an email notification via the remote notifying service.
   * Convenience method for email delivery with standard email parameters.
   *
   * @param {string} to The recipient email address. Must be a valid email format.
   * @param {string} subject The email subject line
   * @param {string} message The email body content (can be HTML or plain text)
   * @param {Object} [options] Optional email-specific configuration:
   *   - html: {boolean} Whether message is HTML (default: false)
   *   - from: {string} Sender email address
   *   - replyTo: {string} Reply-to email address
   *   - attachments: {Array} Array of file attachments
   *   - priority: {string} Email priority ('high', 'normal', 'low')
   * @return {Promise<Object>} A promise that resolves to the email delivery result
   * @throws {Error} When the HTTP request fails or email parameters are invalid
   *
   * @example
   * // Send a simple email
   * await notifyingApi.sendEmail(
   *   'user@example.com',
   *   'Order Confirmation',
   *   'Your order #12345 has been confirmed.'
   * );
   *
   * @example
   * // Send HTML email with options
   * await notifyingApi.sendEmail(
   *   'user@example.com',
   *   'Welcome!',
   *   '<p>Welcome to our service!</p>',
   *   { html: true, priority: 'high' }
   * );
   */
  async sendEmail(to, subject, message, options = {}) {
    return this.send({ channel: 'email', recipient: to, subject, message, options });
  }

  /**
   * Sends an SMS notification via the remote notifying service.
   * Convenience method for SMS delivery with phone numbers.
   *
   * @param {string} to The recipient phone number in E.164 format (e.g., +1234567890)
   * @param {string} message The SMS message content (typically limited to 160 characters)
   * @param {Object} [options] Optional SMS-specific configuration:
   *   - priority: {string} Delivery priority ('high', 'normal')
   *   - encoding: {string} Character encoding ('utf-8', 'gsm7')
   *   - timeout: {number} Delivery timeout in seconds
   * @return {Promise<Object>} A promise that resolves to the SMS delivery result
   * @throws {Error} When the HTTP request fails or SMS parameters are invalid
   *
   * @example
   * // Send SMS verification code
   * await notifyingApi.sendSMS('+14155552671', 'Your verification code is: 123456');
   */
  async sendSMS(to, message, options = {}) {
    return this.send({ channel: 'sms', recipient: to, subject: '', message, options });
  }

  /**
   * Sends a push notification via the remote notifying service.
   * Sends notifications to mobile apps, browsers, or other push-enabled clients.
   *
   * @param {string} to The recipient device identifier or user ID for push delivery
   * @param {string} title The notification title displayed to the user
   * @param {string} message The notification body content
   * @param {Object} [options] Optional push-specific configuration:
   *   - badge: {number} Badge count on app icon
   *   - sound: {string} Sound file for notification
   *   - data: {Object} Custom data payload
   *   - actions: {Array} Interactive notification actions
   *   - priority: {string} Notification priority
   * @return {Promise<Object>} A promise that resolves to the push notification result
   * @throws {Error} When the HTTP request fails or push parameters are invalid
   *
   * @example
   * // Send app push notification
   * await notifyingApi.sendPush(
   *   'user-device-123',
   *   'New Message',
   *   'You have a new message from Alice',
   *   { badge: 1, data: { conversationId: 'conv-456' } }
   * );
   */
  async sendPush(to, title, message, options = {}) {
    return this.send({ channel: 'push', recipient: to, subject: title, message, options });
  }

  /**
   * Retrieves notification delivery history from the remote notifying service.
   * Returns records of previously sent notifications with delivery status and timestamps.
   *
   * @param {Object} [query] Optional query parameters for filtering:
   *   - channel: {string} Filter by notification channel
   *   - recipient: {string} Filter by recipient identifier
   *   - status: {string} Filter by delivery status ('sent', 'failed', 'queued')
   *   - since: {string} ISO timestamp to get notifications sent after this time
   *   - limit: {number} Maximum number of records to return
   * @return {Promise<Array>} A promise that resolves to an array of notification history records
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // Get recent notification history
   * const history = await notifyingApi.getHistory({
   *   channel: 'email',
   *   limit: 50
   * });
   * console.log(`Emails sent: ${history.length}`);
   */
  async getHistory(query = {}) {
    try {
      const response = await this.client.get('/services/notifying/api/history', { params: query });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('notifying:error', { operation: 'getHistory', error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all current configuration settings for the notifying API provider.
   * Returns the settings object including API URL, timeout, and retry configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - apiUrl: {string} The remote API URL
   *   - timeout: {number} Request timeout in milliseconds
   *   - retryLimit: {number} Maximum number of retry attempts
   *
   * @example
   * const settings = await notifyingApi.getSettings();
   * console.log(`API URL: ${settings.apiUrl}`);
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the notifying API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.apiUrl] The new remote API URL
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @param {number} [settings.retryLimit] The new retry limit
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update API timeout
   * await notifyingApi.saveSettings({
   *   timeout: 15000,
   *   apiUrl: 'https://notify-api.internal.service'
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
    // Rebuild axios client if URL or timeout changed
    if (settings.url || settings.timeout) {
      this.apiRoot = this.settings.url;
      this.timeout = this.settings.timeout;
      this.client = axios.create({
        baseURL: this.apiRoot,
        timeout: this.timeout,
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
      });
    }
  }
}

module.exports = NotifyingApi;
