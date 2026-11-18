/**
 * @fileoverview Unit tests for the API-based logging service functionality.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const createLogger = require('../../../src/logging');
const EventEmitter = require('events');
const nock = require('nock');

describe('Logging API Provider', () => {
  let logger;
  let mockEventEmitter;
  const apiRoot = 'http://backend.example.com';
  const apiKey = 'test-api-key-12345';

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    logger = createLogger('api', {
      apiRoot,
      apiKey
    }, mockEventEmitter);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should log info messages via API', async () => {
    const message = 'Test info message';
    const meta = { userId: '123' };

    nock(apiRoot)
      .post('/services/logging/api/log', {
        level: 'info',
        message,
        meta
      })
      .matchHeader('X-API-Key', apiKey)
      .reply(200);

    await logger.info(message, meta);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('log:info:default', {
      level: 'info',
      message
    });
  });

  it('should log error messages via API', async () => {
    const message = 'Test error message';
    const meta = { stack: 'error stack' };

    nock(apiRoot)
      .post('/services/logging/api/log', {
        level: 'error',
        message,
        meta
      })
      .matchHeader('X-API-Key', apiKey)
      .reply(200);

    await logger.error(message, meta);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('log:error:default', {
      level: 'error',
      message
    });
  });

  it('should log warn messages via API', async () => {
    const message = 'Test warning message';

    nock(apiRoot)
      .post('/services/logging/api/log', {
        level: 'warn',
        message,
        meta: {}
      })
      .matchHeader('X-API-Key', apiKey)
      .reply(200);

    await logger.warn(message);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('log:warn:default', {
      level: 'warn',
      message
    });
  });

  it('should log debug messages via API', async () => {
    const message = 'Test debug message';

    nock(apiRoot)
      .post('/services/logging/api/log', {
        level: 'debug',
        message,
        meta: {}
      })
      .matchHeader('X-API-Key', apiKey)
      .reply(200);

    await logger.debug(message);
  });

  it('should query logs via API', async () => {
    const query = { level: 'error', startDate: '2025-10-01' };
    const expectedLogs = [
      { level: 'error', message: 'Error 1', timestamp: '2025-10-06T10:00:00Z' },
      { level: 'error', message: 'Error 2', timestamp: '2025-10-06T11:00:00Z' }
    ];

    nock(apiRoot)
      .get('/services/logging/api/logs')
      .query(query)
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedLogs);

    const result = await logger.query(query);

    expect(result).toEqual(expectedLogs);
  });

  it('should handle logging errors silently', async () => {
    nock(apiRoot)
      .post('/services/logging/api/log')
      .matchHeader('X-API-Key', apiKey)
      .reply(500, 'Internal Server Error');

    // Should not throw, but should emit error event
    await logger.info('test message');

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('logging:error',
      expect.objectContaining({
        operation: 'log'
      })
    );
  });
});
