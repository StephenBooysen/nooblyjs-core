/**
 * @fileoverview Comprehensive feature verification tests for Logging Service
 * Tests all documented features from LOGGING-SERVICE-USAGE.md
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const EventEmitter = require('events');
const Logging = require('../../../src/logging/providers/logging');
const LogAnalytics = require('../../../src/logging/modules/analytics');

describe('Logging Service - Feature Verification', () => {
  let logger;
  let eventEmitter;

  beforeEach(() => {
    eventEmitter = new EventEmitter();
    logger = new Logging({ instanceName: 'default' }, eventEmitter);
  });

  describe('Core Service API Methods', () => {
    describe('info() method', () => {
      test('should log info message', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        await logger.info('Test info message');

        expect(logSpy).toHaveBeenCalled();
        const loggedMessage = logSpy.mock.calls[0][0];
        expect(loggedMessage).toContain('INFO');
        expect(loggedMessage).toContain('Test info message');

        logSpy.mockRestore();
      });

      test('should log info with metadata object', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const metadata = { userId: 123, duration: 145 };

        await logger.info('Request processed', metadata);

        expect(logSpy).toHaveBeenCalled();

        logSpy.mockRestore();
      });

      test('should emit info event', async () => {
        const eventHandler = jest.fn();
        eventEmitter.on('log:info:default', eventHandler);

        await logger.info('Test message');

        expect(eventHandler).toHaveBeenCalled();
      });

      test('should include timestamp in log', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();

        await logger.info('Test message');

        const loggedMessage = logSpy.mock.calls[0][0];
        expect(loggedMessage).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

        logSpy.mockRestore();
      });

      test('should respect minimum log level', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        await logger.info('This should not be logged');

        expect(logSpy).not.toHaveBeenCalled();

        logSpy.mockRestore();
      });
    });

    describe('warn() method', () => {
      test('should log warning message', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await logger.warn('Test warning');

        expect(warnSpy).toHaveBeenCalled();
        const loggedMessage = warnSpy.mock.calls[0][0];
        expect(loggedMessage).toContain('WARN');
        expect(loggedMessage).toContain('Test warning');

        warnSpy.mockRestore();
      });

      test('should emit warn event', async () => {
        const eventHandler = jest.fn();
        eventEmitter.on('log:warn:default', eventHandler);

        await logger.warn('Warning message');

        expect(eventHandler).toHaveBeenCalled();
      });

      test('should log with metadata', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await logger.warn('Cache issue', { hitRate: 0.35 });

        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      test('should respect log level filtering', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        await logger.warn('This should not be logged');

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });
    });

    describe('error() method', () => {
      test('should log error message', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        await logger.error('Test error');

        expect(errorSpy).toHaveBeenCalled();
        const loggedMessage = errorSpy.mock.calls[0][0];
        expect(loggedMessage).toContain('ERROR');
        expect(loggedMessage).toContain('Test error');

        errorSpy.mockRestore();
      });

      test('should emit error event', async () => {
        const eventHandler = jest.fn();
        eventEmitter.on('log:error:default', eventHandler);

        await logger.error('Error message');

        expect(eventHandler).toHaveBeenCalled();
      });

      test('should log with error context', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        await logger.error('Database failed', {
          host: 'db.example.com',
          error: 'ECONNREFUSED'
        });

        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
      });

      test('errors should always be logged regardless of level', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        await logger.error('This should be logged');

        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
      });
    });

    describe('debug() method', () => {
      test('should log debug message', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();

        await logger.debug('Debug info');

        expect(logSpy).toHaveBeenCalled();
        const loggedMessage = logSpy.mock.calls[0][0];
        expect(loggedMessage).toContain('Debug info');

        logSpy.mockRestore();
      });

      test('should emit debug event', async () => {
        const eventHandler = jest.fn();
        eventEmitter.on('log:log:default', eventHandler);

        await logger.debug('Debug message');

        expect(eventHandler).toHaveBeenCalled();
      });

      test('should log with debug metadata', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();

        await logger.debug('Processing', { step: 1, data: 'test' });

        expect(logSpy).toHaveBeenCalled();

        logSpy.mockRestore();
      });
    });

    describe('getSettings() and saveSettings() methods', () => {
      test('should return settings object', async () => {
        const settings = await logger.getSettings();

        expect(settings).toBeDefined();
        expect(typeof settings).toBe('object');
        expect(settings.list).toBeInstanceOf(Array);
      });

      test('should allow updating log level', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        const settings = await logger.getSettings();
        expect(settings.minLogLevel).toBe('error');
      });

      test('should enforce new log level after save', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        await logger.info('Should not be logged');

        expect(logSpy).not.toHaveBeenCalled();

        logSpy.mockRestore();
      });
    });
  });

  describe('Log Level Filtering', () => {
    describe('shouldLog() method', () => {
      test('should allow error logs at error level', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        expect(logger.shouldLog('error')).toBe(true);
      });

      test('should block warn logs at error level', async () => {
        await logger.saveSettings({ minLogLevel: 'error' });

        expect(logger.shouldLog('warn')).toBe(false);
      });

      test('should allow all logs at info level', async () => {
        await logger.saveSettings({ minLogLevel: 'info' });

        expect(logger.shouldLog('error')).toBe(true);
        expect(logger.shouldLog('warn')).toBe(true);
        expect(logger.shouldLog('info')).toBe(true);
      });

      test('should allow all logs at log level', async () => {
        await logger.saveSettings({ minLogLevel: 'log' });

        expect(logger.shouldLog('error')).toBe(true);
        expect(logger.shouldLog('warn')).toBe(true);
        expect(logger.shouldLog('info')).toBe(true);
        expect(logger.shouldLog('log')).toBe(true);
      });
    });
  });

  describe('Analytics Module', () => {
    let analytics;

    beforeEach(() => {
      analytics = new LogAnalytics(eventEmitter, 'default');
    });

    describe('Event Listening', () => {
      test('should track info events', async () => {
        eventEmitter.emit('log:info:default', {
          message: '2025-11-22T10:30:00Z - INFO - host - Test message'
        });

        const logs = analytics.list('INFO');
        expect(logs.length).toBe(1);
        expect(logs[0].level).toBe('INFO');
      });

      test('should track warn events', async () => {
        eventEmitter.emit('log:warn:default', {
          message: '2025-11-22T10:30:00Z - WARN - host - Warning'
        });

        const logs = analytics.list('WARN');
        expect(logs.length).toBe(1);
      });

      test('should track error events', async () => {
        eventEmitter.emit('log:error:default', {
          message: '2025-11-22T10:30:00Z - ERROR - host - Error'
        });

        const logs = analytics.list('ERROR');
        expect(logs.length).toBe(1);
      });

      test('should track log/debug events', async () => {
        eventEmitter.emit('log:log:default', {
          message: '2025-11-22T10:30:00Z - host - Debug'
        });

        const logs = analytics.list('LOG');
        expect(logs.length).toBe(1);
      });
    });

    describe('list() method', () => {
      beforeEach(() => {
        eventEmitter.emit('log:info:default', { message: 'Info 1' });
        eventEmitter.emit('log:warn:default', { message: 'Warn 1' });
        eventEmitter.emit('log:error:default', { message: 'Error 1' });
        eventEmitter.emit('log:info:default', { message: 'Info 2' });
      });

      test('should return all logs when no level specified', () => {
        const logs = analytics.list();

        expect(logs.length).toBe(4);
      });

      test('should filter logs by INFO level', () => {
        const logs = analytics.list('INFO');

        expect(logs.length).toBe(2);
        expect(logs.every(log => log.level === 'INFO')).toBe(true);
      });

      test('should filter logs by WARN level', () => {
        const logs = analytics.list('WARN');

        expect(logs.length).toBe(1);
        expect(logs[0].level).toBe('WARN');
      });

      test('should filter logs by ERROR level', () => {
        const logs = analytics.list('ERROR');

        expect(logs.length).toBe(1);
        expect(logs[0].level).toBe('ERROR');
      });

      test('should return logs in newest-first order', () => {
        const logs = analytics.list();

        // Last emitted should be first
        expect(logs[0].message).toContain('Info 2');
      });

      test('should handle case-insensitive level filter', () => {
        const logs1 = analytics.list('info');
        const logs2 = analytics.list('INFO');

        expect(logs1.length).toBe(logs2.length);
      });
    });

    describe('getCount() method', () => {
      test('should return total log count', () => {
        eventEmitter.emit('log:info:default', { message: 'Log 1' });
        eventEmitter.emit('log:info:default', { message: 'Log 2' });
        eventEmitter.emit('log:warn:default', { message: 'Log 3' });

        const count = analytics.getCount();
        expect(count).toBe(3);
      });

      test('should return zero for empty analytics', () => {
        const count = analytics.getCount();
        expect(count).toBe(0);
      });
    });

    describe('getCountByLevel() method', () => {
      beforeEach(() => {
        for (let i = 0; i < 3; i++) {
          eventEmitter.emit('log:info:default', { message: `Info ${i}` });
        }
        for (let i = 0; i < 2; i++) {
          eventEmitter.emit('log:warn:default', { message: `Warn ${i}` });
        }
        eventEmitter.emit('log:error:default', { message: 'Error 1' });
      });

      test('should count INFO logs', () => {
        const count = analytics.getCountByLevel('INFO');
        expect(count).toBe(3);
      });

      test('should count WARN logs', () => {
        const count = analytics.getCountByLevel('WARN');
        expect(count).toBe(2);
      });

      test('should count ERROR logs', () => {
        const count = analytics.getCountByLevel('ERROR');
        expect(count).toBe(1);
      });

      test('should handle case-insensitive level', () => {
        const count1 = analytics.getCountByLevel('info');
        const count2 = analytics.getCountByLevel('INFO');

        expect(count1).toBe(count2);
      });
    });

    describe('getStats() method', () => {
      beforeEach(() => {
        for (let i = 0; i < 6; i++) {
          eventEmitter.emit('log:info:default', { message: `Info ${i}` });
        }
        for (let i = 0; i < 2; i++) {
          eventEmitter.emit('log:warn:default', { message: `Warn ${i}` });
        }
        eventEmitter.emit('log:error:default', { message: 'Error 1' });
      });

      test('should return stats object with correct structure', () => {
        const stats = analytics.getStats();

        expect(stats).toHaveProperty('total');
        expect(stats).toHaveProperty('counts');
        expect(stats).toHaveProperty('percentages');
      });

      test('should calculate correct total', () => {
        const stats = analytics.getStats();
        expect(stats.total).toBe(9);
      });

      test('should count logs by level', () => {
        const stats = analytics.getStats();

        expect(stats.counts.INFO).toBe(6);
        expect(stats.counts.WARN).toBe(2);
        expect(stats.counts.ERROR).toBe(1);
      });

      test('should calculate correct percentages', () => {
        const stats = analytics.getStats();

        expect(parseFloat(stats.percentages.INFO)).toBeCloseTo(66.67, 1);
        expect(parseFloat(stats.percentages.WARN)).toBeCloseTo(22.22, 1);
        expect(parseFloat(stats.percentages.ERROR)).toBeCloseTo(11.11, 1);
      });
    });

    describe('clear() method', () => {
      beforeEach(() => {
        eventEmitter.emit('log:info:default', { message: 'Log 1' });
        eventEmitter.emit('log:info:default', { message: 'Log 2' });
      });

      test('should clear all logs', () => {
        expect(analytics.getCount()).toBe(2);

        analytics.clear();

        expect(analytics.getCount()).toBe(0);
      });

      test('should clear logs from list', () => {
        expect(analytics.list().length).toBe(2);

        analytics.clear();

        expect(analytics.list().length).toBe(0);
      });

      test('should reset stats', () => {
        let stats = analytics.getStats();
        expect(stats.total).toBe(2);

        analytics.clear();

        stats = analytics.getStats();
        expect(stats.total).toBe(0);
      });
    });

    describe('Rolling buffer behavior', () => {
      test('should maintain maximum of 1000 logs', () => {
        // Add 1100 logs
        for (let i = 0; i < 1100; i++) {
          eventEmitter.emit('log:info:default', {
            message: `Log ${i}`
          });
        }

        const count = analytics.getCount();
        expect(count).toBe(1000);
      });

      test('should remove oldest logs when buffer is full', () => {
        // Add exactly 1000 logs
        for (let i = 0; i < 1000; i++) {
          eventEmitter.emit('log:info:default', {
            message: `Log ${i}`
          });
        }

        const logs = analytics.list();
        const lastLog = logs[logs.length - 1]; // Last in array (oldest, since logs are newest-first)
        // After 1000 logs, oldest should be Log 0
        expect(lastLog.message).toContain('Log 0');

        // Add one more log
        eventEmitter.emit('log:info:default', { message: 'Log 1000' });

        const logsAfter = analytics.list();
        // First log should be Log 1000 (newest)
        expect(logsAfter[0].message).toContain('Log 1000');
        // Last log should now be Log 1 (Log 0 removed)
        expect(logsAfter[logsAfter.length - 1].message).toContain('Log 1');
        expect(logsAfter.length).toBe(1000);
      });
    });

    describe('Multiple instances', () => {
      test('should track logs from different instances separately', () => {
        const analytics1 = new LogAnalytics(eventEmitter, 'instance1');
        const analytics2 = new LogAnalytics(eventEmitter, 'instance2');

        eventEmitter.emit('log:info:instance1', { message: 'Instance 1 log' });
        eventEmitter.emit('log:info:instance2', { message: 'Instance 2 log' });

        expect(analytics1.getCount()).toBe(1);
        expect(analytics2.getCount()).toBe(1);
      });
    });
  });

  describe('Message Formatting', () => {
    describe('formatMessage_() method', () => {
      test('should return message as-is for undefined meta', async () => {
        const result = logger.formatMessage_('Test message');
        expect(result).toBe('Test message');
      });

      test('should handle null metadata', async () => {
        const result = logger.formatMessage_('Test message', null);
        expect(result).toBe('Test message');
      });

      test('should stringify object metadata', async () => {
        const metadata = { key: 'value', count: 42 };
        const result = logger.formatMessage_('Test', metadata);

        expect(result).toContain('Test');
        expect(result).toContain('key');
        expect(result).toContain('value');
      });

      test('should handle string metadata', async () => {
        const result = logger.formatMessage_('Test', 'metadata');
        expect(result).toBe('Test metadata');
      });

      test('should handle circular references in objects', async () => {
        const obj = { name: 'test' };
        obj.self = obj; // Create circular reference

        // Should not throw
        const result = logger.formatMessage_('Test', obj);
        expect(result).toBeDefined();
      });
    });
  });

  describe('Integration Patterns', () => {
    describe('Multiple log levels in sequence', () => {
      test('should log all levels with proper formatting', async () => {
        const analytics = new LogAnalytics(eventEmitter, 'default');

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        await logger.info('Info message');
        await logger.warn('Warn message');
        await logger.error('Error message');
        await logger.debug('Debug message');

        expect(consoleSpy).toHaveBeenCalledTimes(2); // info and debug use console.log
        expect(warnSpy).toHaveBeenCalledTimes(1); // warn uses console.warn
        expect(errorSpy).toHaveBeenCalledTimes(1); // error uses console.error

        consoleSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      });
    });

    describe('Analytics accuracy', () => {
      test('should accurately track log distribution', async () => {
        const analytics = new LogAnalytics(eventEmitter, 'default');

        // Log multiple messages
        eventEmitter.emit('log:info:default', { message: 'Info 1' });
        eventEmitter.emit('log:info:default', { message: 'Info 2' });
        eventEmitter.emit('log:warn:default', { message: 'Warn 1' });
        eventEmitter.emit('log:error:default', { message: 'Error 1' });

        const stats = analytics.getStats();
        expect(stats.counts.INFO).toBe(2);
        expect(stats.counts.WARN).toBe(1);
        expect(stats.counts.ERROR).toBe(1);
        expect(stats.total).toBe(4);
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle logging without eventEmitter', async () => {
      const loggerNoEmitter = new Logging({}, null);

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      // Should not throw
      await expect(loggerNoEmitter.info('Test')).resolves.not.toThrow();

      expect(logSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });

    test('should handle very long messages', async () => {
      const longMessage = 'A'.repeat(10000);

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await logger.info(longMessage);

      expect(logSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });
});
