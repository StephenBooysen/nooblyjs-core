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
 * Replaces fs.appendFileSync and other needed functions with Jest mock functions.
 */
jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
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
      `.logs/${filename}`,
      message + '\n',
    );
  });

  /**
   * Test default directory creation and date-based filename.
   * 
   * Verifies that when no filename is specified, a date-based filename
   * is generated and the .logs directory is created.
   */
  it('should use default date-based filename and create .logs directory', async () => {
    const loggerDefault = createLogger('file', {}, new EventEmitter());
    const message = 'Default test message';
    await loggerDefault.log(message);
    
    // Should attempt to create .logs directory
    expect(fs.mkdirSync).toHaveBeenCalledWith('./.logs', { recursive: true });
    
    // Should use date-based filename pattern (we'll check if it starts with .logs/app.)
    const calls = fs.appendFileSync.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toMatch(/^\.logs\/app\.\d{4}-\d{2}-\d{2}\.log$/);
    expect(lastCall[1]).toBe(message + '\n');
  });

  /**
   * Test custom directory option.
   * 
   * Verifies that a custom log directory can be specified via options.
   */
  it('should use custom log directory when specified', async () => {
    const customLogger = createLogger('file', { 
      filename: 'custom.log',
      logDir: './custom-logs'
    }, new EventEmitter());
    const message = 'Custom directory test';
    await customLogger.log(message);
    
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'custom-logs/custom.log',
      message + '\n',
    );
  });
});
