/**
 * @fileoverview Unit tests for the console logging functionality.
 * 
 * This test suite covers the console logger provider, testing message formatting
 * and output to the console. Tests verify proper timestamp formatting and message
 * structure in logged output.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');
const createLogger = require('../../../src/logging');

/**
 * Test suite for console logging operations.
 * 
 * Tests the console logger functionality including message formatting,
 * timestamp generation, and proper console output.
 */
describe('logging', () => {
  /** @type {Object} Logger instance for testing */
  let logger;
  /** @type {jest.SpyInstance} Spy for console.log method */
  let consoleSpy;

  /**
   * Set up test environment before each test case.
   * Creates a console logger instance and mocks console.log.
   */
  beforeEach(() => {
    logger = createLogger('console', {}, new EventEmitter());
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  /**
   * Clean up test environment after each test case.
   * Restores the original console.log implementation.
   */
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  /**
   * Test console logging message format and output.
   * 
   * Verifies that messages are logged to the console with proper formatting
   * including timestamp, hostname, and message content in the expected pattern.
   */
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
