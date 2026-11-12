/**
 * @fileoverview AWS SimpleDB DataService provider for cloud-based storage of JSON objects
 * using Amazon SimpleDB with domain-based organization.
 *
 * @deprecated AWS SimpleDB is deprecated and not available in AWS SDK v3.
 * This provider will not work with AWS SDK v3. Consider using AWS DynamoDB instead.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const AWS = requireOptional('aws-sdk', "dataService('simpledb')");
const { v4: uuidv4 } = require('uuid');

/**
 * A class that implements an AWS SimpleDB-based data storage provider.
 * Stores JSON objects in AWS SimpleDB using domains as containers.
 * @class
 */
class SimpleDbDataRingProvider {
  /**
   * Initializes the SimpleDB client with AWS credentials and configuration.
   * @param {Object} options The options for the SimpleDB client.
   * @param {string} options.region The AWS region.
   * @param {string=} options.accessKeyId The AWS access key ID. (Optional, will use environment variables if not provided)
   * @param {string=} options.secretAccessKey The AWS secret access key. (Optional, will use environment variables if not provided)
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   * @throws {Error} When required region option is not provided.
   */
  constructor(options, eventEmitter) {
    if (!options || !options.region) {
      throw new Error('SimpleDbDataRingProvider requires region in options.');
    }

    // Warning about SDK v2 (will be logged when logger becomes available)
    this.sdkWarning_ = 'SimpleDB provider uses AWS SDK v2 which is in maintenance mode. Consider migrating to DynamoDB which supports AWS SDK v3.';

    AWS.config.update({
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    this.sdb = new AWS.SimpleDB();
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Settings for dataservice SimpleDB provider
    this.settings = {};
    this.settings.description = "Configuration settings for the DataService SimpleDB Provider";
    this.settings.list = [
      {setting: "connectionTimeout", type: "number", values: [30000]},
      {setting: "queryTimeout", type: "number", values: [60000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.connectionTimeout = options.connectionTimeout || this.settings.list[0].values[0];
    this.settings.queryTimeout = options.queryTimeout || this.settings.list[1].values[0];
    this.settings.retryLimit = options.retryLimit || this.settings.list[2].values[0];
  }

  /**
   * Creates a new SimpleDB domain.
   * @param {string} domainName - The name of the domain (container).
   * @returns {Promise<void>} A promise that resolves when the domain is created.
   */
  async createContainer(domainName) {
    const params = {
      DomainName: domainName,
    };
    await this.sdb.createDomain(params).promise();
    if (this.eventEmitter_)
      this.eventEmitter_.emit('api-dataservice-createContainer', { domainName });
  }

  /**
   * Adds a JSON object to a specified SimpleDB domain.
   * @param {string} domainName - The name of the domain.
   * @param {object} jsonObject - The JSON object to add.
   * @returns {Promise<string>} A promise that resolves with the unique item name.
   */
  async add(domainName, jsonObject) {
    const itemName = uuidv4();
    const attributes = Object.keys(jsonObject).map((key) => ({
      Name: key,
      Value: String(jsonObject[key]), // SimpleDB stores values as strings
      Replace: true,
    }));

    const params = {
      DomainName: domainName,
      ItemName: itemName,
      Attributes: attributes,
    };
    await this.sdb.putAttributes(params).promise();
    if (this.eventEmitter_)
      this.eventEmitter_.emit('api-dataservice-add', {
        domainName,
        itemName,
        jsonObject,
      });
    return itemName;
  }

  /**
   * Removes a JSON object from a specified SimpleDB domain by its item name.
   * @param {string} domainName - The name of the domain.
   * @param {string} objectKey - The item name of the JSON object to remove.
   * @returns {Promise<boolean>} A promise that resolves to true if the object was removed, false otherwise.
   */
  async remove(domainName, objectKey) {
    const params = {
      DomainName: domainName,
      ItemName: objectKey,
    };
    try {
      await this.sdb.deleteAttributes(params).promise();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('api-dataservice-remove', { domainName, objectKey });
      return true;
    } catch (error) {
      // If the item doesn't exist, deleteAttributes might still succeed or throw a specific error.
      // For simplicity, we'll assume success if no specific error indicating non-existence is thrown.
      this.logger?.warn(`[${this.constructor.name}] Error deleting item`, {
        objectKey,
        domainName,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Finds JSON objects in a specified SimpleDB domain that contain the search term.
   * SimpleDB queries are SQL-like. This implementation performs a basic search.
   * @param {string} domainName - The name of the domain.
   * @param {string} searchTerm - The term to search for.
   * @returns {Promise<Array<object>>} A promise that resolves with an array of matching JSON objects.
   */
  async find(domainName, searchTerm) {
    const selectExpression = `SELECT * FROM \`${domainName}\` WHERE itemName() LIKE '%${searchTerm}%'`;
    // This is a very basic search. A more robust solution would parse the JSON object
    // and search within its attributes, potentially requiring more complex queries.

    const params = {
      SelectExpression: selectExpression,
    };

    const data = await this.sdb.select(params).promise();
    if (!data.Items) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('api-dataservice-find', {
          domainName,
          searchTerm,
          results: [],
        });
      return [];
    }

    const results = data.Items.map((item) => {
      const obj = { itemName: item.Name }; // Include the item name as part of the object
      item.Attributes.forEach((attr) => {
        obj[attr.Name] = attr.Value;
      });
      return obj;
    });
    if (this.eventEmitter_)
      this.eventEmitter_.emit('api-dataservice-find', {
        domainName,
        searchTerm,
        results,
      });
    return results;
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

module.exports = SimpleDbDataRingProvider;
