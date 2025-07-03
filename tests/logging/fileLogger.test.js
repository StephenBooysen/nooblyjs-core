/**
 * @fileoverview Unit tests for the file logger.
 */

const createLogger = require('../../src/logging');
const fs = require('fs');

jest.mock('fs');

describe('FileLogger', () => {
  let logger;
  const filename = 'test.log';

  beforeEach(() => {
    logger = createLogger('file', {filename});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should log a message to a file', () => {
    const message = 'Test message';
    logger.log(message);
    expect(fs.appendFileSync).toHaveBeenCalledWith(filename, message + '\n');
  });
});
