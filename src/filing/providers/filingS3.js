/**
 * @fileoverview AWS S3 filing provider for cloud-based file operations
 * using Amazon S3 with bucket-based organization and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AWS = require('aws-sdk');

/**
 * A class that implements an AWS S3-based file storage provider.
 * Provides methods for creating, reading, updating, deleting, and listing files in S3.
 * @class
 */
class S3FilingProvider {
  /**
   * Initializes the S3 client with AWS credentials and bucket configuration.
   * @param {Object} options The options for the S3 client.
   * @param {string} options.bucketName The name of the S3 bucket.
   * @param {string} options.region The AWS region.
   * @param {string=} options.accessKeyId The AWS access key ID. (Optional, will use environment variables if not provided)
   * @param {string=} options.secretAccessKey The AWS secret access key. (Optional, will use environment variables if not provided)
   * @param {EventEmitter=} eventEmitter Optional event emitter for file operations.
   * @throws {Error} When required bucketName or region options are not provided.
   */
  constructor(options, eventEmitter) {
    if (!options || !options.bucketName || !options.region) {
      throw new Error(
        'S3FilingProvider requires bucketName and region in options.',
      );
    }

    /** @private @const {string} */
    this.bucketName = options.bucketName;
    AWS.config.update({
      region: options.region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    });
    /** @private @const {AWS.S3} */
    this.s3 = new AWS.S3();
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Uploads a file to S3.
   * @param {string} filePath - The path to the file in the bucket (key).
   * @param {Buffer|ReadableStream|string} content - The content of the file.
   * @returns {Promise<void>}
   */
  async create(filePath, content) {
    const params = {
      Bucket: this.bucketName,
      Key: filePath,
      Body: content,
    };
    try {
      await this.s3.upload(params).promise();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:create', {
          filePath,
          contentType: typeof content,
        });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:create:error', {
          filePath,
          error: error.message,
        });
      throw error;
    }
  }

  /**
   * Downloads a file from S3.
   * @param {string} filePath - The path to the file in the bucket (key).
   * @param {string} [encoding] - Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer.
   * @returns {Promise<Buffer|string>}
   */
  async read(filePath, encoding) {
    const params = {
      Bucket: this.bucketName,
      Key: filePath,
    };
    try {
      const data = await this.s3.getObject(params).promise();
      const content = encoding ? data.Body.toString(encoding) : data.Body;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:read', {
          filePath,
          encoding,
          contentType: encoding ? 'string' : 'Buffer',
        });
      return content;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:read:error', {
          filePath,
          error: error.message,
        });
      throw error;
    }
  }

  /**
   * Deletes a file from S3.
   * @param {string} filePath - The path to the file in the bucket (key).
   * @returns {Promise<void>}
   */
  async delete(filePath) {
    const params = {
      Bucket: this.bucketName,
      Key: filePath,
    };
    try {
      await this.s3.deleteObject(params).promise();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:delete', { filePath });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:delete:error', {
          filePath,
          error: error.message,
        });
      throw error;
    }
  }

  /**
   * Lists files in a specified "directory" (prefix) in S3.
   * @param {string} dirPath - The prefix to list objects under.
   * @returns {Promise<Array<string>>}
   */
  async list(dirPath) {
    const params = {
      Bucket: this.bucketName,
      Prefix: dirPath,
    };
    try {
      const data = await this.s3.listObjectsV2(params).promise();
      const files = data.Contents ? data.Contents.map((item) => item.Key) : [];
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:list', { dirPath, files });
      return files;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:list:error', {
          dirPath,
          error: error.message,
        });
      throw error;
    }
  }

  /**
   * Updates a file in S3 (same as create, as S3 overwrites).
   * @param {string} filePath - The path to the file in the bucket (key).
   * @param {Buffer|ReadableStream|string} content - The new content of the file.
   * @returns {Promise<void>}
   */
  async update(filePath, content) {
    // For S3, update is essentially create (put) as it overwrites if exists
    const params = {
      Bucket: this.bucketName,
      Key: filePath,
      Body: content,
    };
    try {
      await this.s3.upload(params).promise();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:update', {
          filePath,
          contentType: typeof content,
        });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:update:error', {
          filePath,
          error: error.message,
        });
      throw error;
    }
  }
}

module.exports = S3FilingProvider;
