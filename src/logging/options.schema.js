'use strict';
/** Logging provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, any, apiProvider } = require('../shared/config/schemaTypes');

module.exports = {
  common: { properties: { level: str('Minimum level: debug, info, warn or error'), log: any('Log settings object') } },
  providers: {
    memory: { properties: {} },
    file: {
      properties: {
        filename: str('Log file name'),
        logDir: str('Directory for log files (default .temp/logs in tests, ./.application/logs otherwise)'),
        maxFiles: num('Rotated files to keep'),
        maxSize: num('Rotate when a file reaches this many bytes'),
        rotatePeriod: str('Rotation period, e.g. daily')
      }
    },
    api: apiProvider
  }
};
