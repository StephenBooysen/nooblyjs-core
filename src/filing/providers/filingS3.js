/**
 * @fileoverview AWS S3 filing provider for cloud-based file operations
 * using Amazon S3 with bucket-based organization and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { loadOptionalModule } = require('../../shared/utils/optionalRequire');

/** @return {Object} The AWS S3 SDK, loaded on first use */
const s3sdk = () => loadOptionalModule('@aws-sdk/client-s3', 'S3 filing');
const { assertSafeRelativePath } = require('../modules/pathSafety');
const { applyRuntimeSettings, numberRule } = require('../modules/settingsPolicy');

/** Settings that may change while the service runs. Bucket and region are fixed. */
const RUNTIME_RULES = {
  maxUploadSize: numberRule('maxUploadSize', { min: 1, max: 5 * 1024 * 1024 * 1024, integer: true })
};


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

    const clientConfig = {
      region: options.region,
    };

    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      };
    }

    /** @private @const {S3Client} */
    const { S3Client } = loadOptionalModule('@aws-sdk/client-s3', 'S3 filing');
    this.s3 = new S3Client(clientConfig);
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Settings for filing S3 provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Filing S3 Provider";
    this.settings.list = [
      {setting: "maxUploadSize", type: "number", values: [104857600]}
    ];
    this.settings.bucket = options.bucket || this.bucketName;
    this.settings.region = options.region;
    this.settings.maxUploadSize = options.maxUploadSize || 104857600;
  }

  /**
   * Uploads a file to S3.
   * @param {string} filePath - The path to the file in the bucket (key).
   * @param {Buffer|ReadableStream|string} content - The content of the file.
   * @returns {Promise<void>}
   */
  async create(filePath, content) {
    assertSafeRelativePath(filePath);
    const command = new (s3sdk().PutObjectCommand)({
      Bucket: this.bucketName,
      Key: filePath,
      Body: content,
    });
    try {
      await this.s3.send(command);
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
    assertSafeRelativePath(filePath);
    const command = new (s3sdk().GetObjectCommand)({
      Bucket: this.bucketName,
      Key: filePath,
    });
    try {
      const data = await this.s3.send(command);
      const content = encoding ? await data.Body.transformToString(encoding) : await data.Body.transformToByteArray();
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
    assertSafeRelativePath(filePath);
    const command = new (s3sdk().DeleteObjectCommand)({
      Bucket: this.bucketName,
      Key: filePath,
    });
    try {
      await this.s3.send(command);
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
    assertSafeRelativePath(dirPath);
    const command = new (s3sdk().ListObjectsV2Command)({
      Bucket: this.bucketName,
      Prefix: dirPath,
    });
    try {
      const data = await this.s3.send(command);
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
    assertSafeRelativePath(filePath);
    // For S3, update is essentially create (put) as it overwrites if exists
    const command = new (s3sdk().PutObjectCommand)({
      Bucket: this.bucketName,
      Key: filePath,
      Body: content,
    });
    try {
      await this.s3.send(command);
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
      fixed: { bucket: this.settings.bucket, region: this.settings.region }
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

module.exports = S3FilingProvider;
