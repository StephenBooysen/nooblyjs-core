/**
 * @fileoverview Unit tests for the console logger.
 */

const EventEmitter = require('events');
const createLogger = require('../../src/logging');

describe('ConsoleLogger', () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    logger = createLogger('console', {}, new EventEmitter());
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log a message to the console', async () => {
    const message = 'Test message';
    const expectedLogPattern =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - [\w.-]+ - Test message$/;
    await logger.log(message);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(expectedLogPattern),
    );
  });
});
