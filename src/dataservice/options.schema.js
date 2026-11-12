'use strict';
/** DataService provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, bool, apiProvider } = require('../shared/config/schemaTypes');

module.exports = {
  common: { properties: {} },
  providers: {
    memory: { properties: { autoCreateContainers: bool('Create containers on first use'), persistData: bool('Persist to disk') } },
    file: {
      properties: {
        baseDir: str('Base directory'), storageLocation: str('Storage folder'), autoBackup: bool('Keep backups'),
        maxFileSize: num('Max file size in bytes'), autoCreateContainers: bool('Create containers on first use')
      }
    },
    mongodb: {
      open: true,
      properties: {
        connectionString: str('MongoDB connection string'), database: str('Database name'),
        maxConnections: num('Pool size'), connectionTimeout: num('Connect timeout in ms'), queryTimeout: num('Query timeout in ms')
      }
    },
    documentdb: {
      open: true,
      properties: {
        connectionString: str('Connection string'), database: str('Database name'), host: str('Host'), port: num('Port'),
        username: str('User'), password: str('Password'), ssl: bool('Use TLS'),
        maxConnections: num('Pool size'), connectionTimeout: num('Connect timeout in ms'), queryTimeout: num('Query timeout in ms')
      }
    },
    simpledb: {
      open: true,
      properties: {
        region: str('AWS region'), accessKeyId: str('Access key id'), secretAccessKey: str('Secret access key'),
        connectionTimeout: num('Connect timeout in ms'), queryTimeout: num('Query timeout in ms'), retryLimit: num('Retries')
      }
    },
    api: apiProvider
  }
};
