const createNotificationService = require('../../src/notifying');
const EventEmitter = require('events');

describe('NotificationService', () => {
  let notificationService;
  let mockCallback1;
  let mockCallback2;
  let mockEventEmitter;

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

  it('should not throw an error if notifying a non-existent topic', () => {
    const topicName = 'nonExistentTopic';
    const message = 'Test message';

    expect(() => notificationService.notify(topicName, message)).not.toThrow();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'notification:notify',
      expect.any(Object),
    );
  });

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
