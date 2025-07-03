/**
 * @fileoverview Unit tests for the console logger.
 */

const createLogger = require('../../src/logging');

describe('ConsoleLogger', () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    logger = createLogger('console');
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log a message to the console', () => {
    const message = 'Test message';
    logger.log(message);
    const expectedLogPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - [\w.-]+ - Test message$/;
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(expectedLogPattern));
  });
});
