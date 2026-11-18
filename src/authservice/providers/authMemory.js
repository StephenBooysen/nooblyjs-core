/**
 * @fileoverview Memory Authentication Provider
 * In-memory authentication provider for development and testing.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const AuthBase = require('./authBase');

/**
 * Memory-based authentication provider.
 * Stores all user data and sessions in memory.
 * @class
 * @extends {AuthBase}
 */
class AuthMemory extends AuthBase {
  /**
   * Initializes the memory authentication provider.
   * @param {Object=} options Configuration options.
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = "There are not setting for the nooblyjs-core in memory auth implementation"
    this.settings.list = []

    // Create default admin user if specified in options
    if (options.createDefaultAdmin !== false) {
      this.initializeDefaultUsers_().catch(error => {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:initialization-error', {
            error: error.message
          });
        }
      });
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'memory',
        message: 'Memory auth provider initialized'
      });
    }
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
   * Creates default users for development/testing.
   * @private
   */
  async initializeDefaultUsers_() {
  
  }

  /**
   * Gets service status with memory-specific information.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    const baseStatus = await super.getStatus();
    return {
      ...baseStatus,
      provider: 'memory',
      storage: 'in-memory',
      persistent: false
    };
  }
}

module.exports = AuthMemory;