'use strict';
/** Filing provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, bool, obj, any, strOrArr, apiProvider } = require('../shared/config/schemaTypes');

module.exports = {
  common: {
    properties: {
      access: obj('Route tiers: writeRoles, adminRoles, acl (feature 15)'),
      filingAccess: obj('Older name for access'),
      maxFileSize: num('Upload limit in bytes'),
      maxUploadSize: num('Upload limit in bytes (cloud providers)'),
      allowedTypes: strOrArr('Allowed extensions, e.g. "md,txt,pdf"')
    }
  },
  providers: {
    local: { properties: { baseDir: str('Storage root (default ./.application/files); fixed at start-up') } },
    ftp: { open: true, properties: { connectionString: str('ftp://user:pass@host:port/path'), timeout: num('Timeout in ms'), retryLimit: num('Retries') } },
    s3: {
      open: true,
      properties: { bucketName: str('S3 bucket'), bucket: str('S3 bucket (older name)'), region: str('AWS region'), accessKeyId: str('Access key id'), secretAccessKey: str('Secret') },
      aliases: {}
    },
    gcp: {
      open: true,
      properties: {
        bucketName: str('GCS bucket'), bucket: str('GCS bucket (older name)'), projectId: str('Project id'), keyFilename: str('Key file'),
        credentials: obj('Service account credentials'), location: str('Bucket location'), storageClass: str('Storage class')
      }
    },
    git: {
      open: true,
      properties: {
        repoUrl: str('Remote repository URL'), localPath: str('Working copy folder'), branch: str('Branch'), auth: any('Credentials'),
        userName: str('Commit author name'), userEmail: str('Commit author email'), userId: str('User id'),
        autoCommit: bool('Commit on change'), commitInterval: num('Commit interval in ms'), commitMessage: str('Commit message'),
        autoFetch: bool('Fetch periodically'), fetchInterval: num('Fetch interval in ms'), conflictThreshold: num('Conflict threshold')
      }
    },
    sync: {
      open: true,
      properties: {
        remoteType: str('Remote provider type'), remoteOptions: obj('Remote provider options'), remoteProvider: any('Remote provider instance'),
        workingDir: str('Local working folder'), metadataDir: str('Metadata folder'), syncInterval: num('Sync interval in ms'),
        autoSync: bool('Sync periodically'), userId: str('User id')
      }
    },
    api: apiProvider
  }
};
