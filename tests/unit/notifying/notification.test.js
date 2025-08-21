/**
 * @fileoverview Unit tests for the notification service functionality.
 * 
 * This test suite covers the notification service provider, testing
 * topic creation, subscription management, message publishing, and
 * error handling. Tests verify proper event emission and subscriber
 * callback execution.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createNotificationService = require('../../../src/notifying');
const EventEmitter = require('events');

/**
 * Test suite for notification service operations.
 * 
 * Tests the notification service functionality including topic management,
 * subscription handling, message publishing, and error scenarios.
 */
describe('NotificationService', () => {
  /** @type {Object} Notification service instance for testing */
  let notificationService;
  /** @type {jest.Mock} First mock callback for testing subscriptions */
  let mockCallback1;
  /** @type {jest.Mock} Second mock callback for testing subscriptions */
  let mockCallback2;
  /** @type {EventEmitter} Mock event emitter for testing notification events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh notification service instance and mock callbacks.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    notificationService = createNotificationService(
      'default',
      {},
      mockEventEmitter,
    );
    mockCallback1 = jest.fn();
    mockCallback2 = jest.fn();
  });

  /**
   * Test topic creation functionality.
   * 
   * Verifies that topics can be created and are properly initialized
   * with empty subscriber sets.
   */
  it('should create a topic if it does not exist', () => {
    const topicName = 'testTopic';
    notificationService.createTopic(topicName);
    expect(notificationService.topics.has(topicName)).toBe(true);
    expect(notificationService.topics.get(topicName).size).toBe(0);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification:createTopic',
      { topicName },
    );
  });

  /**
   * Test subscription to topics.
   * 
   * Verifies that callbacks can be subscribed to topics and that
   * topics are automatically created if they don't exist.
   */
  it('should allow subscribers to subscribe to a topic', () => {
    const topicName = 'shippingAlerts';
    notificationService.subscribe(topicName, mockCallback1);
    expect(notificationService.topics.has(topicName)).toBe(true);
    expect(notificationService.topics.get(topicName).has(mockCallback1)).toBe(
      true,
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification:subscribe',
      { topicName },
    );
  });

  /**
   * Test notification delivery to all subscribers.
   * 
   * Verifies that all subscribed callbacks are invoked when a
   * notification is published to a topic.
   */
  it('should call all subscribed callbacks when a notification is sent', () => {
    const topicName = 'shippingAlerts';
    const message = 'Your order has shipped!';

    notificationService.subscribe(topicName, mockCallback1);
    notificationService.subscribe(topicName, mockCallback2);
    mockEventEmitter.emit.mockClear(); // Clear previous emits

    notificationService.notify(topicName, message);

    expect(mockCallback1).toHaveBeenCalledTimes(1);
    expect(mockCallback1).toHaveBeenCalledWith(message);
    expect(mockCallback2).toHaveBeenCalledTimes(1);
    expect(mockCallback2).toHaveBeenCalledWith(message);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('notification:notify', {
      topicName,
      message,
    });
  });

  /**
   * Test unsubscription functionality.
   * 
   * Verifies that unsubscribed callbacks are not invoked when
   * notifications are sent to a topic.
   */
  it('should not notify unsubscribed callbacks', () => {
    const topicName = 'shippingAlerts';
    const message = 'Your order has shipped!';

    notificationService.subscribe(topicName, mockCallback1);
    notificationService.subscribe(topicName, mockCallback2);
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    notificationService.unsubscribe(topicName, mockCallback1);

    notificationService.notify(topicName, message);

    expect(mockCallback1).not.toHaveBeenCalled();
    expect(mockCallback2).toHaveBeenCalledTimes(1);
    expect(mockCallback2).toHaveBeenCalledWith(message);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification:unsubscribe',
      { topicName },
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('notification:notify', {
      topicName,
      message,
    });
  });

  /**
   * Test notification to non-existent topics.
   * 
   * Verifies that publishing to non-existent topics does not
   * throw errors and handles gracefully.
   */
  it('should not throw an error if notifying a non-existent topic', () => {
    const topicName = 'nonExistentTopic';
    const message = 'Test message';

    expect(() => notificationService.notify(topicName, message)).not.toThrow();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'notification:notify',
      expect.any(Object),
    );
  });

  /**
   * Test unsubscription from non-existent topics.
   * 
   * Verifies that unsubscribing from non-existent topics returns
   * false and handles gracefully without errors.
   */
  it('should not throw an error if unsubscribing from a non-existent topic', () => {
    const topicName = 'nonExistentTopic';

    expect(notificationService.unsubscribe(topicName, mockCallback1)).toBe(
      false,
    );
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'notification:unsubscribe',
      expect.any(Object),
    );
  });

  /**
   * Test error handling in subscriber callbacks.
   * 
   * Verifies that errors in subscriber callbacks are caught and logged
   * without preventing other callbacks from executing.
   */
  it('should handle errors in subscriber callbacks gracefully', () => {
    const topicName = 'errorTopic';
    const errorMessage = 'Callback error';
    const errorCallback = jest.fn(() => {
      throw new Error(errorMessage);
    });
    const normalCallback = jest.fn();

    notificationService.subscribe(topicName, errorCallback);
    notificationService.subscribe(topicName, normalCallback);

    // Mock console.error to prevent test output pollution and check if it's called
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockEventEmitter.emit.mockClear(); // Clear previous emits

    notificationService.notify(topicName, 'test message');

    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(normalCallback).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `Error in notification callback for topic ${topicName}:`,
      expect.any(Error),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'notification:notify:error',
      { topicName, message: 'test message', error: errorMessage },
    );

    consoleErrorSpy.mockRestore(); // Restore original console.error
  });
});
