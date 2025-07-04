/**
 * @fileoverview FTP filing provider.
 */

const Client = require('ftp');

class FtpFilingProvider {
  constructor(options, eventEmitter) {
    this.connectionString = options.connectionString;
    this.client = new Client();
    this.isConnected = false;
    this.eventEmitter_ = eventEmitter;

    this.client.on('ready', () => {
      this.isConnected = true;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:connected', {
          connectionString: this.connectionString,
        });
    });

    this.client.on('end', () => {
      this.isConnected = false;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:disconnected', {
          connectionString: this.connectionString,
        });
    });

    this.client.on('error', (err) => {
      console.error('FTP Client Error:', err);
      this.isConnected = false;
      if (this.eventEmitter_)
        this.eventEmitter_.emit('filing:ftp:error', {
          connectionString: this.connectionString,
          error: err.message,
        });
    });
  }

  async connect() {
    if (this.isConnected) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.client.connect(this.connectionString);
      this.client.once('ready', () => {
        this.isConnected = true;
        resolve();
      });
      this.client.once('error', reject);
    });
  }

  async disconnect() {
    if (this.isConnected) {
      this.client.end();
    }
  }

  async create(filePath, content) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.put(Buffer.from(content), filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:create:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:create', { filePath, content });
        resolve();
      });
    });
  }

  async read(filePath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      let data = '';
      this.client.get(filePath, (err, stream) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        stream.on('data', (chunk) => (data += chunk.toString()));
        stream.on('end', () => {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read', { filePath, content: data });
          resolve(data);
        });
        stream.on('error', (err) => {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:read:error', {
              filePath,
              error: err.message,
            });
          reject(err);
        });
      });
    });
  }

  async delete(filePath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.delete(filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:delete:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:delete', { filePath });
        resolve();
      });
    });
  }

  async list(dirPath) {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.list(dirPath, (err, list) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:list:error', {
              dirPath,
              error: err.message,
            });
          return reject(err);
        }
        const files = list.map((item) => item.name);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:list', { dirPath, files });
        resolve(files);
      });
    });
  }

  async update(filePath, content) {
    // For FTP, update is essentially create (put) as it overwrites if exists
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.put(Buffer.from(content), filePath, (err) => {
        if (err) {
          if (this.eventEmitter_)
            this.eventEmitter_.emit('filing:update:error', {
              filePath,
              error: err.message,
            });
          return reject(err);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('filing:update', { filePath, content });
        resolve();
      });
    });
  }
}

module.exports = FtpFilingProvider;
