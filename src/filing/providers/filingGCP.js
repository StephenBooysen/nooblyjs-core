/**
 * @fileoverview Google Cloud Storage filing provider for file operations
 * in Google Cloud Storage with event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

/**
 * A class that implements a Google Cloud Storage-based file storage provider.
 * Provides methods for creating, reading, updating, deleting, and listing files in GCS buckets.
 * @class
 */
class GCPFilingProvider {
  /**
   * Initializes the Google Cloud Storage provider.
   * @param {Object=} options Configuration options for GCS connection.
   * @param {string=} options.bucketName GCS bucket name (required).
   * @param {string=} options.projectId GCP project ID (optional, can be from service account).
   * @param {string=} options.keyFilename Path to service account key file (defaults to './.config/cloud-storage.json').
   * @param {Object=} options.credentials Service account credentials object (alternative to keyFilename).
   * @param {string=} options.location Bucket location for creation (defaults to 'US').
   * @param {string=} options.storageClass Bucket storage class for creation (defaults to 'STANDARD').
   * @param {EventEmitter=} eventEmitter Optional event emitter for file operations.
   */
  constructor(options = {}, eventEmitter) {
    if (!options.bucketName) {
      throw new Error('GCP Filing Provider requires a bucketName in options');
    }

    /** @private @const {string} */
    this.bucketName_ = options.bucketName;
    
    /** @private @const {string} */
    this.location_ = options.location || 'US';
    
    /** @private @const {string} */
    this.storageClass_ = options.storageClass || 'STANDARD';
    
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
    
    // Configure Google Cloud Storage client
    const storageOptions = {};
    
    if (options.projectId) {
      storageOptions.projectId = options.projectId;
    }
    
    // Use either credentials object or key file
    if (options.credentials) {
      storageOptions.credentials = options.credentials;
    } else {
      storageOptions.keyFilename = options.keyFilename || './.config/cloud-storage.json';
    }
    
    try {
      /** @private @const {Storage} */
      this.storage_ = new Storage(storageOptions);
      
      /** @private @const {Object} */
      this.bucket_ = this.storage_.bucket(this.bucketName_);
      
      // Check if bucket exists and create if it doesn't
      this._ensureBucketExists().catch(error => {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('filing:gcp:error', {
            operation: 'ensureBucketExists',
            error: error.message
          });
        }
      });
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:initialized', {
          bucketName: this.bucketName_,
          projectId: storageOptions.projectId,
          keyFile: storageOptions.keyFilename
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'initialize',
          error: error.message
        });
      }
      throw new Error(`GCP Storage initialization failed: ${error.message}`);
    }
  }

  /**
   * Ensures the bucket exists and creates it if it doesn't.
   * @return {Promise<void>} A promise that resolves when bucket exists or is created.
   * @private
   */
  async _ensureBucketExists() {
    try {
      const [exists] = await this.bucket_.exists();
      
      if (!exists) {
        await this.bucket_.create({
          location: this.location_,
          storageClass: this.storageClass_
        });
        
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('filing:gcp:bucketCreated', {
            bucketName: this.bucketName_,
            location: this.location_,
            storageClass: this.storageClass_
          });
        }
      } else {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('filing:gcp:bucketExists', {
            bucketName: this.bucketName_
          });
        }
      }
    } catch (error) {
      throw new Error(`Failed to ensure bucket '${this.bucketName_}' exists: ${error.message}`);
    }
  }

  /**
   * Creates a new file in Google Cloud Storage.
   * @param {string} filePath The path where the file should be created in the bucket.
   * @param {Buffer|ReadableStream|string} content The content to write to the file.
   * @return {Promise<void>} A promise that resolves when the file is created.
   * @throws {Error} When file creation fails.
   */
  async create(filePath, content) {
    try {
      const file = this.bucket_.file(filePath);
      
      if (content && typeof content.pipe === 'function') {
        // Handle ReadableStream
        await this._uploadFromStream(file, content);
      } else if (Buffer.isBuffer(content) || typeof content === 'string') {
        // Handle Buffer or string
        await file.save(content);
      } else {
        throw new Error('Unsupported content type. Must be Buffer, ReadableStream, or string');
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:create', {
          filePath,
          bucketName: this.bucketName_,
          contentType: typeof content,
          provider: 'gcp'
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'create',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to create file '${filePath}' in GCS: ${error.message}`);
    }
  }

  /**
   * Reads a file from Google Cloud Storage.
   * @param {string} filePath The path of the file to read from the bucket.
   * @param {string} [encoding] Optional encoding (e.g., 'utf8', 'base64'), defaults to Buffer.
   * @return {Promise<Buffer|string>} A promise that resolves to the file content.
   * @throws {Error} When file reading fails.
   */
  async read(filePath, encoding) {
    try {
      const file = this.bucket_.file(filePath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File '${filePath}' does not exist in bucket '${this.bucketName_}'`);
      }
      
      const [content] = await file.download();
      
      const result = encoding ? content.toString(encoding) : content;
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:read', {
          filePath,
          bucketName: this.bucketName_,
          encoding,
          contentType: encoding ? 'string' : 'Buffer',
          provider: 'gcp'
        });
      }
      
      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'read',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to read file '${filePath}' from GCS: ${error.message}`);
    }
  }

  /**
   * Deletes a file from Google Cloud Storage.
   * @param {string} filePath The path of the file to delete from the bucket.
   * @return {Promise<void>} A promise that resolves when the file is deleted.
   * @throws {Error} When file deletion fails.
   */
  async delete(filePath) {
    try {
      const file = this.bucket_.file(filePath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File '${filePath}' does not exist in bucket '${this.bucketName_}'`);
      }
      
      await file.delete();
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:delete', {
          filePath,
          bucketName: this.bucketName_,
          provider: 'gcp'
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'delete',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to delete file '${filePath}' from GCS: ${error.message}`);
    }
  }

  /**
   * Lists files in a Google Cloud Storage bucket directory.
   * @param {string} [dirPath=''] The path of the directory to list (defaults to root).
   * @return {Promise<Array<string>>} A promise that resolves to an array of file names.
   * @throws {Error} When directory listing fails.
   */
  async list(dirPath = '') {
    try {
      const prefix = dirPath ? (dirPath.endsWith('/') ? dirPath : dirPath + '/') : '';
      const delimiter = '/';
      
      const [files] = await this.bucket_.getFiles({
        prefix,
        delimiter
      });
      
      // Extract file names, removing the prefix
      const fileNames = files.map(file => {
        const fileName = file.name;
        return prefix ? fileName.replace(prefix, '') : fileName;
      }).filter(name => name.length > 0); // Remove empty names
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:list', {
          dirPath,
          bucketName: this.bucketName_,
          files: fileNames,
          provider: 'gcp'
        });
      }
      
      return fileNames;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'list',
          dirPath,
          error: error.message
        });
      }
      throw new Error(`Failed to list files in '${dirPath}' from GCS: ${error.message}`);
    }
  }

  /**
   * Updates an existing file in Google Cloud Storage.
   * @param {string} filePath The path of the file to update in the bucket.
   * @param {Buffer|ReadableStream|string} content The new content for the file.
   * @return {Promise<void>} A promise that resolves when the file is updated.
   * @throws {Error} When file update fails.
   */
  async update(filePath, content) {
    try {
      const file = this.bucket_.file(filePath);
      
      if (content && typeof content.pipe === 'function') {
        // Handle ReadableStream
        await this._uploadFromStream(file, content);
      } else if (Buffer.isBuffer(content) || typeof content === 'string') {
        // Handle Buffer or string
        await file.save(content);
      } else {
        throw new Error('Unsupported content type. Must be Buffer, ReadableStream, or string');
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:update', {
          filePath,
          bucketName: this.bucketName_,
          contentType: typeof content,
          provider: 'gcp'
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'update',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to update file '${filePath}' in GCS: ${error.message}`);
    }
  }

  /**
   * Gets metadata for a file in Google Cloud Storage.
   * @param {string} filePath The path of the file to get metadata for.
   * @return {Promise<Object>} A promise that resolves to file metadata.
   * @throws {Error} When metadata retrieval fails.
   */
  async getMetadata(filePath) {
    try {
      const file = this.bucket_.file(filePath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`File '${filePath}' does not exist in bucket '${this.bucketName_}'`);
      }
      
      const [metadata] = await file.getMetadata();
      
      const result = {
        name: metadata.name,
        bucket: metadata.bucket,
        size: parseInt(metadata.size, 10),
        contentType: metadata.contentType,
        created: new Date(metadata.timeCreated),
        updated: new Date(metadata.updated),
        etag: metadata.etag,
        generation: metadata.generation
      };
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:metadata', {
          filePath,
          bucketName: this.bucketName_,
          metadata: result
        });
      }
      
      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'getMetadata',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to get metadata for '${filePath}' from GCS: ${error.message}`);
    }
  }

  /**
   * Copies a file within Google Cloud Storage.
   * @param {string} sourcePath The path of the source file.
   * @param {string} destinationPath The path where the file should be copied.
   * @return {Promise<void>} A promise that resolves when the file is copied.
   * @throws {Error} When file copying fails.
   */
  async copy(sourcePath, destinationPath) {
    try {
      const sourceFile = this.bucket_.file(sourcePath);
      const destinationFile = this.bucket_.file(destinationPath);
      
      // Check if source file exists
      const [exists] = await sourceFile.exists();
      if (!exists) {
        throw new Error(`Source file '${sourcePath}' does not exist in bucket '${this.bucketName_}'`);
      }
      
      await sourceFile.copy(destinationFile);
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:copy', {
          sourcePath,
          destinationPath,
          bucketName: this.bucketName_
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'copy',
          sourcePath,
          destinationPath,
          error: error.message
        });
      }
      throw new Error(`Failed to copy file from '${sourcePath}' to '${destinationPath}' in GCS: ${error.message}`);
    }
  }

  /**
   * Moves a file within Google Cloud Storage.
   * @param {string} sourcePath The path of the source file.
   * @param {string} destinationPath The path where the file should be moved.
   * @return {Promise<void>} A promise that resolves when the file is moved.
   * @throws {Error} When file moving fails.
   */
  async move(sourcePath, destinationPath) {
    try {
      await this.copy(sourcePath, destinationPath);
      await this.delete(sourcePath);
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:move', {
          sourcePath,
          destinationPath,
          bucketName: this.bucketName_
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'move',
          sourcePath,
          destinationPath,
          error: error.message
        });
      }
      throw new Error(`Failed to move file from '${sourcePath}' to '${destinationPath}' in GCS: ${error.message}`);
    }
  }

  /**
   * Generates a signed URL for accessing a file.
   * @param {string} filePath The path of the file to generate URL for.
   * @param {Object} [options={}] URL generation options.
   * @param {string} [options.action='read'] The action ('read', 'write', 'delete').
   * @param {Date|number} [options.expires] Expiration time (Date object or timestamp).
   * @return {Promise<string>} A promise that resolves to the signed URL.
   * @throws {Error} When URL generation fails.
   */
  async generateSignedUrl(filePath, options = {}) {
    try {
      const file = this.bucket_.file(filePath);
      
      const signedUrlOptions = {
        action: options.action || 'read',
        expires: options.expires || Date.now() + 15 * 60 * 1000 // Default: 15 minutes
      };
      
      const [url] = await file.getSignedUrl(signedUrlOptions);
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:signedUrl', {
          filePath,
          bucketName: this.bucketName_,
          action: signedUrlOptions.action,
          expires: signedUrlOptions.expires
        });
      }
      
      return url;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'generateSignedUrl',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to generate signed URL for '${filePath}': ${error.message}`);
    }
  }

  /**
   * Checks if a file exists in Google Cloud Storage.
   * @param {string} filePath The path of the file to check.
   * @return {Promise<boolean>} A promise that resolves to true if the file exists.
   * @throws {Error} When existence check fails.
   */
  async exists(filePath) {
    try {
      const file = this.bucket_.file(filePath);
      const [exists] = await file.exists();
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:exists', {
          filePath,
          bucketName: this.bucketName_,
          exists
        });
      }
      
      return exists;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'exists',
          filePath,
          error: error.message
        });
      }
      throw new Error(`Failed to check existence of '${filePath}' in GCS: ${error.message}`);
    }
  }

  /**
   * Gets the bucket configuration and status.
   * @return {Promise<Object>} A promise that resolves to bucket information.
   */
  async getBucketInfo() {
    try {
      const [metadata] = await this.bucket_.getMetadata();
      
      const result = {
        name: metadata.name,
        location: metadata.location,
        storageClass: metadata.storageClass,
        created: new Date(metadata.timeCreated),
        updated: new Date(metadata.updated)
      };
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:bucketInfo', result);
      }
      
      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('filing:gcp:error', {
          operation: 'getBucketInfo',
          error: error.message
        });
      }
      throw new Error(`Failed to get bucket info: ${error.message}`);
    }
  }

  /**
   * Uploads a file from a ReadableStream.
   * @param {Object} file GCS file object.
   * @param {ReadableStream} stream The readable stream to upload.
   * @return {Promise<void>} A promise that resolves when the upload completes.
   * @private
   */
  async _uploadFromStream(file, stream) {
    return new Promise((resolve, reject) => {
      const uploadStream = file.createWriteStream({
        metadata: {
          contentType: 'application/octet-stream' // Default content type
        }
      });

      uploadStream.on('error', reject);
      uploadStream.on('finish', resolve);

      stream.pipe(uploadStream);
      stream.on('error', reject);
    });
  }
}

module.exports = GCPFilingProvider;