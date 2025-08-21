/**
 * @fileoverview AWS SimpleDB DataServe provider for cloud-based storage of JSON objects
 * using Amazon SimpleDB with domain-based organization.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AWS = require('aws-sdk');
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

    AWS.config.update({
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    /** @private @const {AWS.SimpleDB} */
    this.sdb = new AWS.SimpleDB();
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
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
      this.eventEmitter_.emit('dataserve:createContainer', { domainName });
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
      this.eventEmitter_.emit('dataserve:add', {
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
        this.eventEmitter_.emit('dataserve:remove', { domainName, objectKey });
      return true;
    } catch (error) {
      // If the item doesn't exist, deleteAttributes might still succeed or throw a specific error.
      // For simplicity, we'll assume success if no specific error indicating non-existence is thrown.
      console.warn(
        `Error deleting item ${objectKey} from domain ${domainName}: ${error.message}`,
      );
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
        this.eventEmitter_.emit('dataserve:find', {
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
      this.eventEmitter_.emit('dataserve:find', {
        domainName,
        searchTerm,
        results,
      });
    return results;
  }
}

module.exports = SimpleDbDataRingProvider;
