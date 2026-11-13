/**
 * @fileoverview Unit tests for the AWS SQS, Azure Queue Storage and Google
 * Cloud Tasks queueing providers.
 *
 * The cloud SDKs are replaced with in-memory Jest mocks (virtual where the
 * optional SDK is not installed), so the tests cover each provider's
 * request building, message (de)serialisation, prefix handling, analytics,
 * events and error wrapping without any network access.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');

// ─── AWS SQS mock ────────────────────────────────────────────────────
const sqsSend = jest.fn();
const sqsDestroy = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => {
  const command = (type) => jest.fn().mockImplementation((input) => ({ type, input }));
  return {
    SQSClient: jest.fn().mockImplementation(() => ({ send: sqsSend, destroy: sqsDestroy })),
    SendMessageCommand: command('send'),
    ReceiveMessageCommand: command('receive'),
    DeleteMessageCommand: command('delete'),
    PurgeQueueCommand: command('purge'),
    GetQueueAttributesCommand: command('attributes'),
    ListQueuesCommand: command('list')
  };
});

// ─── Azure Queue Storage mock ────────────────────────────────────────
const azureQueues = new Map();
function azureQueue(name) {
  if (!azureQueues.has(name)) {
    const messages = [];
    let id = 0;
    azureQueues.set(name, {
      messages,
      createIfNotExists: jest.fn(async () => {}),
      sendMessage: jest.fn(async (text) => { messages.push({ messageId: String(++id), popReceipt: 'r', messageText: text }); }),
      receiveMessages: jest.fn(async ({ numberOfMessages = 1 } = {}) => ({ receivedMessageItems: messages.slice(0, numberOfMessages) })),
      deleteMessage: jest.fn(async (messageId) => {
        const i = messages.findIndex((m) => m.messageId === messageId);
        if (i >= 0) messages.splice(i, 1);
      }),
      getProperties: jest.fn(async () => ({ approximateMessagesCount: messages.length }))
    });
  }
  return azureQueues.get(name);
}
jest.mock('@azure/storage-queue', () => ({
  QueueClient: jest.fn(),
  QueueServiceClient: {
    fromConnectionString: jest.fn(() => ({
      getQueueClient: (name) => azureQueue(name),
      listQueues: () => (async function* list() {
        for (const name of azureQueues.keys()) yield { name };
      })()
    }))
  }
}), { virtual: true });

// ─── Google Cloud Tasks mock ─────────────────────────────────────────
const gcpClient = {
  queuePath: jest.fn((p, r, q) => `projects/${p}/locations/${r}/queues/${q}`),
  taskPath: jest.fn((p, r, q, t) => `projects/${p}/locations/${r}/queues/${q}/tasks/${t}`),
  locationPath: jest.fn((p, r) => `projects/${p}/locations/${r}`),
  createTask: jest.fn(async () => [{}]),
  listQueues: jest.fn(async () => [[{ name: 'projects/p/locations/r/queues/remote-q' }]]),
  purgeQueue: jest.fn(async () => {})
};
jest.mock('@google-cloud/tasks', () => ({ CloudTasksClient: jest.fn(() => gcpClient) }));

const QueueingAWS = require('../../../src/queueing/providers/queueingAWS');
const QueueingAzure = require('../../../src/queueing/providers/queueingAzure');
const QueueingGCP = require('../../../src/queueing/providers/queueingGCP');

describe('QueueingAWS', () => {
  let queue;
  let events;

  beforeEach(() => {
    sqsSend.mockReset();
    events = new EventEmitter();
    jest.spyOn(events, 'emit');
    queue = new QueueingAWS({ accountId: '123', region: 'eu-west-1', queueNamePrefix: 'app', accessKeyId: 'a', secretAccessKey: 's' }, events);
  });

  it('enqueues JSON messages to the resolved queue URL', async () => {
    sqsSend.mockResolvedValue({});
    await queue.enqueue('jobs', { id: 1 });
    expect(sqsSend).toHaveBeenCalledWith({
      type: 'send',
      input: { QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123/app-jobs', MessageBody: '{"id":1}', DelaySeconds: 0 }
    });
    expect(events.emit).toHaveBeenCalledWith('queue:enqueue:default', { queueName: 'jobs', item: { id: 1 } });
    expect(queue.getAnalytics()).toEqual([expect.objectContaining({ queueName: 'jobs', operations: 1 })]);
  });

  it('dequeues, parses and deletes a message', async () => {
    sqsSend
      .mockResolvedValueOnce({ Messages: [{ Body: '{"id":2}', ReceiptHandle: 'rh' }] })
      .mockResolvedValueOnce({});
    expect(await queue.dequeue('jobs')).toEqual({ id: 2 });
    expect(sqsSend.mock.calls[1][0]).toEqual({ type: 'delete', input: expect.objectContaining({ ReceiptHandle: 'rh' }) });

    sqsSend.mockResolvedValueOnce({ Messages: [{ Body: 'plain', ReceiptHandle: 'rh' }] }).mockResolvedValueOnce({});
    expect(await queue.dequeue('jobs')).toBe('plain');

    sqsSend.mockResolvedValueOnce({ Messages: [] });
    expect(await queue.dequeue('jobs')).toBeUndefined();
  });

  it('reports size, lists queues without the prefix and purges', async () => {
    sqsSend.mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: '7' } });
    expect(await queue.size('jobs')).toBe(7);
    sqsSend.mockResolvedValueOnce({});
    expect(await queue.size('jobs')).toBe(0);

    sqsSend.mockResolvedValueOnce({ QueueUrls: ['https://sqs/123/app-jobs', 'https://sqs/123/other'] });
    expect(await queue.listQueues()).toEqual(['jobs', 'other']);
    sqsSend.mockResolvedValueOnce({});
    expect(await queue.listQueues()).toEqual([]);

    sqsSend.mockResolvedValueOnce({});
    await queue.purge('jobs');
    expect(events.emit).toHaveBeenCalledWith('queue:purge:default', { queueName: 'jobs' });
  });

  it('wraps SDK failures with context', async () => {
    sqsSend.mockRejectedValue(new Error('throttled'));
    await expect(queue.enqueue('jobs', 1)).rejects.toThrow('Failed to enqueue item to queue "jobs": throttled');
    await expect(queue.dequeue('jobs')).rejects.toThrow('Failed to dequeue');
    await expect(queue.size('jobs')).rejects.toThrow('Failed to get size');
    await expect(queue.listQueues()).rejects.toThrow('Failed to list queues');
    await expect(queue.purge('jobs')).rejects.toThrow('Failed to purge');
  });

  it('requires an account id', async () => {
    const previous = process.env.AWS_ACCOUNT_ID;
    delete process.env.AWS_ACCOUNT_ID;
    try {
      const noAccount = new QueueingAWS({}, events);
      await expect(noAccount.enqueue('q', 1)).rejects.toThrow('AWS Account ID is required');
    } finally {
      if (previous !== undefined) process.env.AWS_ACCOUNT_ID = previous;
    }
  });

  it('evicts the least recently used queue URL when the cache is full', async () => {
    sqsSend.mockResolvedValue({});
    queue.maxCacheEntries_ = 2;
    queue.maxAnalyticsEntries_ = 2;
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 1);
    await queue.enqueue('c', 1);
    expect(queue.queueCache_.size).toBe(2);
    expect(queue.getAnalytics()).toHaveLength(2);
  });

  it('exposes settings, connection info and disconnects', async () => {
    await queue.saveSettings({ visibilityTimeout: 60 });
    expect((await queue.getSettings()).visibilityTimeout).toBe(60);
    expect(queue.getConnectionInfo()).toEqual(expect.objectContaining({ provider: 'aws-sqs', region: 'eu-west-1' }));
    await queue.disconnect();
    expect(sqsDestroy).toHaveBeenCalled();
  });
});

describe('QueueingAzure', () => {
  let queue;
  let events;

  beforeEach(() => {
    azureQueues.clear();
    events = new EventEmitter();
    jest.spyOn(events, 'emit');
    queue = new QueueingAzure({ connectionString: 'UseDevelopmentStorage=true', queueNamePrefix: 'App' }, events);
  });

  it('requires a connection string', () => {
    const previous = process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    try {
      expect(() => new QueueingAzure({}, events)).toThrow('connection string is required');
    } finally {
      if (previous !== undefined) process.env.AZURE_STORAGE_CONNECTION_STRING = previous;
    }
  });

  it('enqueues, sizes and dequeues through a sanitised queue name', async () => {
    await queue.enqueue('Jobs_1', { id: 1 });
    await queue.enqueue('Jobs_1', 'text');
    expect(azureQueues.has('app-jobs-1')).toBe(true);
    expect(await queue.size('Jobs_1')).toBe(2);
    expect(await queue.dequeue('Jobs_1')).toEqual({ id: 1 });
    expect(await queue.dequeue('Jobs_1')).toBe('text');
    expect(await queue.dequeue('Jobs_1')).toBeUndefined();
    expect(events.emit).toHaveBeenCalledWith('queue:dequeue:default', expect.objectContaining({ queueName: 'Jobs_1' }));
    expect(queue.getAnalytics()[0]).toEqual(expect.objectContaining({ queueName: 'Jobs_1' }));
  });

  it('rejects messages over 64KB', async () => {
    await expect(queue.enqueue('big', 'x'.repeat(70000))).rejects.toThrow('exceeds 64KB');
  });

  it('lists and purges queues', async () => {
    await queue.enqueue('a', 1);
    await queue.enqueue('a', 2);
    expect(await queue.listQueues()).toEqual(expect.arrayContaining([expect.stringContaining('a')]));
    await queue.purge('a');
    expect(await queue.size('a')).toBe(0);
  });

  it('wraps queue client failures', async () => {
    await queue.enqueue('f', 1);
    azureQueues.get('app-f').getProperties.mockRejectedValue(new Error('403'));
    await expect(queue.size('f')).rejects.toThrow('Failed to get size of queue "f": 403');
  });

  it('exposes settings', async () => {
    await queue.saveSettings({ visibilityTimeout: 45 });
    expect((await queue.getSettings()).visibilityTimeout).toBe(45);
  });
});

describe('QueueingGCP', () => {
  let events;

  beforeEach(() => {
    jest.clearAllMocks();
    events = new EventEmitter();
    jest.spyOn(events, 'emit');
  });

  it('requires a project id', () => {
    const saved = [process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT_ID];
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT_ID;
    try {
      expect(() => new QueueingGCP({}, events)).toThrow('Project ID is required');
    } finally {
      if (saved[0] !== undefined) process.env.GOOGLE_CLOUD_PROJECT = saved[0];
      if (saved[1] !== undefined) process.env.GCP_PROJECT_ID = saved[1];
    }
  });

  it('falls back to a local FIFO without an HTTP target', async () => {
    const queue = new QueueingGCP({ projectId: 'p' }, events);
    await queue.enqueue('q', { id: 1 });
    await queue.enqueue('q', { id: 2 });
    expect(await queue.size('q')).toBe(2);
    expect(await queue.dequeue('q')).toEqual({ id: 1 });
    expect(await queue.dequeue('missing')).toBeUndefined();
    // Listing asks Cloud Tasks and falls back to the local queues on failure.
    gcpClient.listQueues.mockRejectedValueOnce(new Error('no credentials'));
    expect(await queue.listQueues()).toEqual(expect.arrayContaining(['q']));
    await queue.purge('q');
    expect(await queue.size('q')).toBe(0);
    expect(gcpClient.createTask).not.toHaveBeenCalled();
    expect(queue.getConnectionInfo()).toEqual(expect.objectContaining({ httpTarget: 'none (local fallback)' }));
  });

  it('creates Cloud Tasks when an HTTP target is configured', async () => {
    const queue = new QueueingGCP({ projectId: 'p', region: 'r', httpTarget: 'https://worker.test/task', keyFilePath: '/k.json' }, events);
    await queue.enqueue('q', { id: 1 });
    expect(gcpClient.createTask).toHaveBeenCalledWith(expect.objectContaining({
      parent: 'projects/p/locations/r/queues/q'
    }));
    expect(await queue.listQueues()).toEqual(['remote-q']);
    await queue.purge('q');
    expect(gcpClient.purgeQueue).toHaveBeenCalledWith({ name: 'projects/p/locations/r/queues/q' });
    expect(events.emit).toHaveBeenCalledWith('queue:enqueue:default', expect.objectContaining({ queueName: 'q' }));
  });

  it('wraps Cloud Tasks failures', async () => {
    gcpClient.createTask.mockRejectedValueOnce(new Error('denied'));
    const queue = new QueueingGCP({ projectId: 'p', httpTarget: 'https://w.test' }, events);
    await expect(queue.enqueue('q', 1)).rejects.toThrow('Failed to enqueue item to queue "q": denied');
  });

  it('exposes settings and analytics', async () => {
    const queue = new QueueingGCP({ projectId: 'p' }, events);
    await queue.enqueue('q', 1);
    await queue.saveSettings({ maxRetries: 9 });
    expect((await queue.getSettings()).maxRetries).toBe(9);
    expect(queue.getAnalytics()).toEqual([expect.objectContaining({ queueName: 'q' })]);
  });
});
