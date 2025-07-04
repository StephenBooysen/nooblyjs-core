/**
 * @fileoverview Local file system filing provider.
 */

const fs = require('fs').promises;

class LocalFilingProvider {
  constructor(options, eventEmitter) {
    this.eventEmitter_ = eventEmitter;
  }

  async create(filePath, content) {
    await fs.writeFile(filePath, content);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:create', { filePath, content });
  }

  async read(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:read', { filePath, content });
    return content;
  }

  async delete(filePath) {
    await fs.unlink(filePath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:delete', { filePath });
  }

  async list(dirPath) {
    const files = await fs.readdir(dirPath);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:list', { dirPath, files });
    return files;
  }

  async update(filePath, content) {
    await fs.writeFile(filePath, content);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('filing:update', { filePath, content });
  }
}

module.exports = LocalFilingProvider;
