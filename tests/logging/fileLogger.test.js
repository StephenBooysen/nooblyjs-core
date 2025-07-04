/**
 * @fileoverview Unit tests for the file logger.
 */

const EventEmitter = require('events');

jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
}));

const fs = require('fs');
const createLogger = require('../../src/logging');

describe('FileLogger', () => {
  let logger;
  const filename = 'test.log';

  beforeEach(() => {
    logger = createLogger('file', { filename }, new EventEmitter());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should log a message to a file', async () => {
    const message = 'Test message';
    await logger.log(message);
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      filename,
      message + '\n',
    );
  });
});
