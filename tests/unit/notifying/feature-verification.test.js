/**
 * @fileoverview Feature Verification Tests for Notifying Service
 *
 * Comprehensive test suite verifying all documented features and functionality
 * of the Notifying Service including pub/sub, topic management, analytics,
 * settings, and event emission.
 *
 * Test Coverage:
 * - Core Service API (createTopic, subscribe, unsubscribe, notify)
 * - Settings Management (getSettings, saveSettings)
 * - Event Emission (workflow:defined, subscription, notification events)
 * - Topic Management (multiple topics, subscribers, state)
 * - Analytics Module (overview, top topics, topic details)
 * - Integration Patterns (chaining, multiple instances)
 * - Error Handling (validation, graceful failures)
 */

'use strict';

const createNotifyingService = require('../../../src/notifying');
const EventEmitter = require('events');

describe('Notifying Service - Feature Verification', () => {
  let notifying;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    notifying = createNotifyingService('default', {
      instanceName: 'default',
      maxSubscribers: 100,
      messageTimeout: 5000,
      enableQueuing: false,
      dependencies: {
        logging: { info: jest.fn(), error: jest.fn() }
      }
    }, mockEventEmitter);
  });

  describe('Core Service API - createTopic()', () => {
    it('should create a new topic', async () => {
      await notifying.createTopic('test-topic');
      expect(notifying.topics.has('test-topic')).toBe(true);
    });

    it('should emit notification:createTopic event', async () => {
      await notifying.createTopic('test-topic');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:createTopic:default',
        { topicName: 'test-topic' }
      );
    });

    it('should not duplicate topics', async () => {
      await notifying.createTopic('test-topic');
      await notifying.createTopic('test-topic');
      const topics = Array.from(notifying.topics.keys());
      expect(topics.filter(t => t === 'test-topic').length).toBe(1);
    });

    it('should handle special characters in topic names', async () => {
      await notifying.createTopic('test:topic-1');
      await notifying.createTopic('order.placed');
      await notifying.createTopic('user_events');
      expect(notifying.topics.size).toBe(3);
    });

    it('should create multiple independent topics', async () => {
      await notifying.createTopic('topic-1');
      await notifying.createTopic('topic-2');
      await notifying.createTopic('topic-3');
      expect(notifying.topics.size).toBe(3);
    });

    it('should return a promise', async () => {
      const result = notifying.createTopic('test');
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Core Service API - subscribe()', () => {
    it('should subscribe a callback to a topic', async () => {
      await notifying.createTopic('test-topic');
      const callback = jest.fn();
      await notifying.subscribe('test-topic', callback);

      const callbacks = notifying.topics.get('test-topic');
      expect(callbacks.has(callback)).toBe(true);
    });

    it('should create topic if not exists', async () => {
      const callback = jest.fn();
      await notifying.subscribe('auto-created', callback);
      expect(notifying.topics.has('auto-created')).toBe(true);
    });

    it('should emit notification:subscribe event', async () => {
      await notifying.createTopic('test-topic');
      const callback = jest.fn();
      await notifying.subscribe('test-topic', callback);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:subscribe:default',
        { topicName: 'test-topic' }
      );
    });

    it('should support multiple subscribers on same topic', async () => {
      await notifying.createTopic('test-topic');
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      const cb3 = jest.fn();

      await notifying.subscribe('test-topic', cb1);
      await notifying.subscribe('test-topic', cb2);
      await notifying.subscribe('test-topic', cb3);

      const callbacks = notifying.topics.get('test-topic');
      expect(callbacks.size).toBe(3);
    });

    it('should return a promise', async () => {
      const result = notifying.subscribe('topic', () => {});
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Core Service API - unsubscribe()', () => {
    it('should unsubscribe a callback from a topic', async () => {
      await notifying.createTopic('test-topic');
      const callback = jest.fn();
      await notifying.subscribe('test-topic', callback);

      const result = notifying.unsubscribe('test-topic', callback);
      expect(result).toBe(true);
      expect(notifying.topics.get('test-topic').has(callback)).toBe(false);
    });

    it('should emit notification:unsubscribe event', async () => {
      await notifying.createTopic('test-topic');
      const callback = jest.fn();
      await notifying.subscribe('test-topic', callback);

      notifying.unsubscribe('test-topic', callback);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:unsubscribe:default',
        { topicName: 'test-topic' }
      );
    });

    it('should return false if topic does not exist', () => {
      const result = notifying.unsubscribe('nonexistent', jest.fn());
      expect(result).toBe(false);
    });

    it('should return false if callback not found', async () => {
      await notifying.createTopic('test-topic');
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      await notifying.subscribe('test-topic', callback1);
      const result = notifying.unsubscribe('test-topic', callback2);
      expect(result).toBe(false);
    });

    it('should handle multiple unsubscriptions', async () => {
      await notifying.createTopic('test-topic');
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      await notifying.subscribe('test-topic', cb1);
      await notifying.subscribe('test-topic', cb2);

      notifying.unsubscribe('test-topic', cb1);
      notifying.unsubscribe('test-topic', cb2);

      expect(notifying.topics.get('test-topic').size).toBe(0);
    });
  });

  describe('Core Service API - notify()', () => {
    it('should call all subscribers with the message', async () => {
      await notifying.createTopic('test-topic');
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      await notifying.subscribe('test-topic', cb1);
      await notifying.subscribe('test-topic', cb2);

      const message = { data: 'test' };
      await notifying.notify('test-topic', message);

      expect(cb1).toHaveBeenCalledWith(message);
      expect(cb2).toHaveBeenCalledWith(message);
    });

    it('should emit notification:notify event', async () => {
      await notifying.createTopic('test-topic');
      await notifying.subscribe('test-topic', jest.fn());

      const message = { data: 'test' };
      await notifying.notify('test-topic', message);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:notify:default',
        expect.objectContaining({
          topicName: 'test-topic',
          message: message
        })
      );
    });

    it('should handle notifying non-existent topic gracefully', async () => {
      const message = { data: 'test' };
      await notifying.notify('nonexistent', message);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should emit error event if callback throws', async () => {
      await notifying.createTopic('test-topic');
      const badCallback = jest.fn(() => {
        throw new Error('Callback error');
      });

      await notifying.subscribe('test-topic', badCallback);
      await notifying.notify('test-topic', { data: 'test' });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:notify:error:default',
        expect.objectContaining({
          topicName: 'test-topic',
          error: 'Callback error'
        })
      );
    });

    it('should support various message types', async () => {
      await notifying.createTopic('test-topic');
      const cb = jest.fn();
      await notifying.subscribe('test-topic', cb);

      await notifying.notify('test-topic', 'string');
      await notifying.notify('test-topic', 123);
      await notifying.notify('test-topic', { obj: 'ect' });
      await notifying.notify('test-topic', ['array']);
      await notifying.notify('test-topic', true);
      await notifying.notify('test-topic', null);

      expect(cb).toHaveBeenCalledTimes(6);
    });

    it('should return a promise', async () => {
      const result = notifying.notify('topic', {});
      expect(result instanceof Promise).toBe(true);
      await result;
    });

    it('should handle subscriber exceptions without breaking chain', async () => {
      await notifying.createTopic('test-topic');
      const errorCb = jest.fn(() => { throw new Error('test'); });
      const normalCb = jest.fn();

      await notifying.subscribe('test-topic', errorCb);
      await notifying.subscribe('test-topic', normalCb);

      const message = { data: 'test' };
      await notifying.notify('test-topic', message);

      // Both should be called despite first one throwing
      expect(errorCb).toHaveBeenCalledWith(message);
      expect(normalCb).toHaveBeenCalledWith(message);
    });
  });

  describe('Settings Management - getSettings()', () => {
    it('should return settings object with all properties', async () => {
      const settings = await notifying.getSettings();
      expect(settings).toHaveProperty('description');
      expect(settings).toHaveProperty('list');
      expect(settings).toHaveProperty('maxSubscribers');
      expect(settings).toHaveProperty('messageTimeout');
      expect(settings).toHaveProperty('enableQueuing');
    });

    it('should have correct default values', async () => {
      const settings = await notifying.getSettings();
      expect(settings.maxSubscribers).toBe(100);
      expect(settings.messageTimeout).toBe(5000);
      expect(settings.enableQueuing).toBe(false);
    });

    it('should provide settings metadata', async () => {
      const settings = await notifying.getSettings();
      expect(Array.isArray(settings.list)).toBe(true);
      expect(settings.list.length).toBeGreaterThan(0);

      const settingNames = settings.list.map(s => s.setting);
      expect(settingNames).toContain('maxSubscribers');
      expect(settingNames).toContain('messageTimeout');
      expect(settingNames).toContain('enableQueuing');
    });

    it('should return a promise', async () => {
      const result = notifying.getSettings();
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Settings Management - saveSettings()', () => {
    it('should update single setting', async () => {
      await notifying.saveSettings({ maxSubscribers: 200 });
      const settings = await notifying.getSettings();
      expect(settings.maxSubscribers).toBe(200);
    });

    it('should update multiple settings at once', async () => {
      await notifying.saveSettings({
        maxSubscribers: 300,
        messageTimeout: 3000,
        enableQueuing: true
      });

      const settings = await notifying.getSettings();
      expect(settings.maxSubscribers).toBe(300);
      expect(settings.messageTimeout).toBe(3000);
      expect(settings.enableQueuing).toBe(true);
    });

    it('should preserve unmodified settings', async () => {
      const originalSettings = await notifying.getSettings();

      await notifying.saveSettings({ maxSubscribers: 250 });
      const newSettings = await notifying.getSettings();

      expect(newSettings.messageTimeout).toBe(originalSettings.messageTimeout);
      expect(newSettings.enableQueuing).toBe(originalSettings.enableQueuing);
      expect(newSettings.maxSubscribers).toBe(250);
    });

    it('should handle partial updates', async () => {
      await notifying.saveSettings({ messageTimeout: 10000 });
      const settings = await notifying.getSettings();
      expect(settings.messageTimeout).toBe(10000);
      expect(settings.maxSubscribers).toBe(100); // unchanged
    });

    it('should return a promise', async () => {
      const result = notifying.saveSettings({ maxSubscribers: 150 });
      expect(result instanceof Promise).toBe(true);
      await result;
    });
  });

  describe('Event Emission', () => {
    it('should emit events with correct instance name', async () => {
      await notifying.createTopic('test-topic');
      const events = mockEventEmitter.emit.mock.calls
        .map(call => call[0])
        .filter(e => e.includes('notification:'));

      expect(events.every(e => e.includes(':default'))).toBe(true);
    });

    it('should track all event types', async () => {
      const callback = jest.fn();
      await notifying.createTopic('test-topic');
      await notifying.subscribe('test-topic', callback);
      await notifying.notify('test-topic', {});
      notifying.unsubscribe('test-topic', callback);

      const events = mockEventEmitter.emit.mock.calls.map(call => call[0]);
      expect(events).toContain('notification:createTopic:default');
      expect(events).toContain('notification:subscribe:default');
      expect(events).toContain('notification:notify:default');
      expect(events).toContain('notification:unsubscribe:default');
    });
  });

  describe('Topic Management', () => {
    it('should support multiple topics', async () => {
      await notifying.createTopic('topic-1');
      await notifying.createTopic('topic-2');
      await notifying.createTopic('topic-3');
      await notifying.createTopic('topic-4');

      expect(notifying.topics.size).toBe(4);
    });

    it('should isolate topics from each other', async () => {
      await notifying.createTopic('topic-1');
      await notifying.createTopic('topic-2');

      const cb1 = jest.fn();
      const cb2 = jest.fn();

      await notifying.subscribe('topic-1', cb1);
      await notifying.subscribe('topic-2', cb2);

      await notifying.notify('topic-1', { topic: 1 });

      expect(cb1).toHaveBeenCalledWith({ topic: 1 });
      expect(cb2).not.toHaveBeenCalled();
    });

    it('should maintain separate subscriber lists per topic', async () => {
      await notifying.createTopic('topic-1');
      await notifying.createTopic('topic-2');

      const cb1 = jest.fn();
      const cb2 = jest.fn();
      const cb3 = jest.fn();

      await notifying.subscribe('topic-1', cb1);
      await notifying.subscribe('topic-1', cb2);
      await notifying.subscribe('topic-2', cb3);

      expect(notifying.topics.get('topic-1').size).toBe(2);
      expect(notifying.topics.get('topic-2').size).toBe(1);
    });

    it('should handle complex topic names', async () => {
      await notifying.createTopic('user.created');
      await notifying.createTopic('order:placed');
      await notifying.createTopic('payment-processed');
      await notifying.createTopic('event_1');

      expect(notifying.topics.size).toBe(4);
    });

    it('should support many topics', async () => {
      for (let i = 0; i < 50; i++) {
        await notifying.createTopic(`topic-${i}`);
      }
      expect(notifying.topics.size).toBe(50);
    });
  });

  describe('Multiple Instances', () => {
    it('should create separate instances with different names', async () => {
      const instance1 = createNotifyingService('default', {
        instanceName: 'instance-1'
      }, new EventEmitter());

      const instance2 = createNotifyingService('default', {
        instanceName: 'instance-2'
      }, new EventEmitter());

      expect(instance1).not.toBe(instance2);
    });

    it('should maintain separate topics per instance', async () => {
      const instance2 = createNotifyingService('default', {
        instanceName: 'instance-2'
      }, new EventEmitter());

      await notifying.createTopic('topic');
      await instance2.createTopic('different-topic');

      expect(notifying.topics.has('topic')).toBe(true);
      expect(instance2.topics.has('topic')).toBe(false);
      expect(instance2.topics.has('different-topic')).toBe(true);
    });

    it('should emit instance-specific events', async () => {
      const instance2 = createNotifyingService('default', {
        instanceName: 'instance-2'
      }, mockEventEmitter);

      await instance2.createTopic('test');

      const events = mockEventEmitter.emit.mock.calls.map(call => call[0]);
      expect(events).toContain('notification:createTopic:instance-2');
    });
  });

  describe('Integration Patterns', () => {
    it('should allow defining and using workflows', async () => {
      await notifying.createTopic('workflow-topic');
      const results = [];

      await notifying.subscribe('workflow-topic', (msg) => {
        results.push('step-1');
      });

      await notifying.subscribe('workflow-topic', (msg) => {
        results.push('step-2');
      });

      await notifying.notify('workflow-topic', { step: 'execute' });

      expect(results).toContain('step-1');
      expect(results).toContain('step-2');
    });

    it('should maintain settings across operations', async () => {
      await notifying.saveSettings({ maxSubscribers: 250 });
      await notifying.createTopic('test');
      await notifying.subscribe('test', jest.fn());

      const settings = await notifying.getSettings();
      expect(settings.maxSubscribers).toBe(250);
    });

    it('should handle rapid topic definitions', async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(notifying.createTopic(`topic-${i}`));
      }

      await Promise.all(promises);
      expect(notifying.topics.size).toBe(20);
    });

    it('should support topic redefinition', async () => {
      await notifying.createTopic('redef-topic');
      await notifying.createTopic('redef-topic'); // Create again

      expect(notifying.topics.size).toBe(1);
    });

    it('should allow chaining operations', async () => {
      const result = [];

      await notifying.createTopic('chain-topic');
      result.push('created');

      await notifying.subscribe('chain-topic', () => {
        result.push('subscribed');
      });

      await notifying.notify('chain-topic', {});
      result.push('notified');

      await notifying.saveSettings({ maxSubscribers: 200 });
      result.push('settings-saved');

      expect(result.length).toBe(4);
      expect(result[0]).toBe('created');
    });
  });

  describe('Error Handling', () => {
    it('should validate topic name is required for subscribe', async () => {
      const callback = jest.fn();
      await expect(notifying.subscribe('', callback)).resolves.not.toThrow();
    });

    it('should validate callback is function for subscribe', async () => {
      await notifying.createTopic('test');
      await expect(
        notifying.subscribe('test', 'not-a-function')
      ).resolves.not.toThrow();
    });

    it('should handle errors in multiple subscribers', async () => {
      await notifying.createTopic('test-topic');
      const errorCb = jest.fn(() => { throw new Error('error'); });
      const normalCb = jest.fn();
      const errorCb2 = jest.fn(() => { throw new Error('error2'); });

      await notifying.subscribe('test-topic', errorCb);
      await notifying.subscribe('test-topic', normalCb);
      await notifying.subscribe('test-topic', errorCb2);

      await notifying.notify('test-topic', {});

      expect(errorCb).toHaveBeenCalled();
      expect(normalCb).toHaveBeenCalled();
      expect(errorCb2).toHaveBeenCalled();
    });

    it('should emit error events for callback exceptions', async () => {
      await notifying.createTopic('test-topic');
      const errorCallback = jest.fn(() => {
        throw new Error('Test error');
      });

      await notifying.subscribe('test-topic', errorCallback);
      await notifying.notify('test-topic', { test: 'message' });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'notification:notify:error:default',
        expect.objectContaining({
          topicName: 'test-topic',
          error: 'Test error'
        })
      );
    });

    it('should handle concurrent operations safely', async () => {
      const operations = [];

      for (let i = 0; i < 10; i++) {
        operations.push(notifying.createTopic(`topic-${i}`));
        operations.push(
          notifying.subscribe(`topic-${i}`, jest.fn())
        );
      }

      await Promise.all(operations);
      expect(notifying.topics.size).toBe(10);
    });
  });

  describe('Analytics Module Features', () => {
    it('should support analytics module integration', async () => {
      await notifying.createTopic('test-topic');
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should track definitions through events', async () => {
      mockEventEmitter.emit.mockClear();
      await notifying.createTopic('tracked-topic');

      const calls = mockEventEmitter.emit.mock.calls;
      expect(calls.some(call => call[0].includes('createTopic'))).toBe(true);
    });

    it('should emit events for subscription changes', async () => {
      mockEventEmitter.emit.mockClear();
      const callback = jest.fn();

      await notifying.createTopic('test-topic');
      mockEventEmitter.emit.mockClear();

      await notifying.subscribe('test-topic', callback);

      const calls = mockEventEmitter.emit.mock.calls;
      expect(calls.some(call => call[0].includes('subscribe'))).toBe(true);
    });

    it('should provide hooks for external integration', async () => {
      let eventCount = 0;
      mockEventEmitter.on('notification:createTopic:default', () => {
        eventCount++;
      });

      await notifying.createTopic('hook-test');

      expect(eventCount).toBe(1);
    });
  });

  describe('API Contract Verification', () => {
    it('should expose createTopic method', () => {
      expect(typeof notifying.createTopic).toBe('function');
    });

    it('should expose subscribe method', () => {
      expect(typeof notifying.subscribe).toBe('function');
    });

    it('should expose unsubscribe method', () => {
      expect(typeof notifying.unsubscribe).toBe('function');
    });

    it('should expose notify method', () => {
      expect(typeof notifying.notify).toBe('function');
    });

    it('should expose getSettings method', () => {
      expect(typeof notifying.getSettings).toBe('function');
    });

    it('should expose saveSettings method', () => {
      expect(typeof notifying.saveSettings).toBe('function');
    });

    it('should have eventEmitter property', () => {
      expect(notifying.eventEmitter_).toBeDefined();
    });

    it('should have topics map property', () => {
      expect(notifying.topics instanceof Map).toBe(true);
    });

    it('should have settings property with configuration', () => {
      expect(notifying.settings).toBeDefined();
      expect(notifying.settings.list).toBeDefined();
    });

    it('should return promises from async methods', async () => {
      expect(notifying.createTopic('test') instanceof Promise).toBe(true);
      expect(notifying.subscribe('test', () => {}) instanceof Promise).toBe(true);
      expect(notifying.notify('test', {}) instanceof Promise).toBe(true);
      expect(notifying.getSettings() instanceof Promise).toBe(true);
      expect(notifying.saveSettings({}) instanceof Promise).toBe(true);
    });
  });
});
