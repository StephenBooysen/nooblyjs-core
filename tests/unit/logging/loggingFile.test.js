/**
 * @fileoverview Unit tests for the file logging functionality.
 * 
 * This test suite covers the file logger provider, testing file writing
 * operations and message persistence to disk. Tests verify proper file
 * handling and message formatting for file output.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');

/**
 * Mock fs module for testing file operations.
 * Replaces fs.appendFileSync with a Jest mock function.
 */
jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
}));

const fs = require('fs');
const createLogger = require('../../../src/logging');

/**
 * Test suite for file logging operations.
 * 
 * Tests the file logger functionality including message writing to files,
 * file handling, and proper message formatting for file output.
 */
describe('loggingFile', () => {
  /** @type {Object} File logger instance for testing */
  let logger;
  /** @type {string} Test log filename */
  const filename = 'test.log';

  /**
   * Set up test environment before each test case.
   * Creates a file logger instance with test configuration.
   */
  beforeEach(() => {
    logger = createLogger('file', { filename }, new EventEmitter());
  });

  /**
   * Clean up test environment after each test case.
   * Clears all Jest mocks to prevent test interference.
   */
  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test file logging message writing.
   * 
   * Verifies that messages are written to the specified file with proper
   * formatting including newline termination.
   */
  it('should log a message to a file', async () => {
    const message = 'Test message';
    await logger.log(message);
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      filename,
      message + '\n',
    );
  });
});
