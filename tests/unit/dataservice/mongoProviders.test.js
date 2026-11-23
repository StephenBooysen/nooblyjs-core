/**
 * @fileoverview Unit tests for the MongoDB and DocumentDB dataservice
 * providers and their shared MongoBaseProvider.
 *
 * The mongodb driver is replaced with an in-memory fake, so these run
 * without a database (the live-database suites stay gated behind
 * RUN_MONGODB_TESTS / RUN_DOCUMENTDB_TESTS).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');

/** In-memory stand-in for a MongoDB collection. */
class FakeCollection {
  constructor() {
    this.docs = [];
    this.createIndex = jest.fn(async () => 'uuid_1');
  }
  async insertOne(doc) { this.docs.push({ _id: `id${this.docs.length}`, ...doc }); return { insertedId: `id${this.docs.length - 1}` }; }
  async findOne(q) { return this.docs.find((d) => d.uuid === q.uuid) || null; }
  async deleteOne(q) {
    const i = this.docs.findIndex((d) => d.uuid === q.uuid);
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async updateOne(q, { $set }) {
    const doc = this.docs.find((d) => d.uuid === q.uuid);
    if (doc) Object.assign(doc, $set);
    return { modifiedCount: doc ? 1 : 0 };
  }
  async replaceOne(q, replacement) {
    const i = this.docs.findIndex((d) => d.uuid === q.uuid);
    if (i >= 0) this.docs[i] = { _id: this.docs[i]._id, ...replacement };
    return { matchedCount: i >= 0 ? 1 : 0, modifiedCount: i >= 0 ? 1 : 0 };
  }
  async countDocuments() { return this.docs.length; }
  find() {
    let i = 0;
    const docs = this.docs;
    return { hasNext: async () => i < docs.length, next: async () => docs[i++] };
  }
}

const mongoState = { collections: new Map(), connectError: null, clients: [] };

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation((uri, options) => {
    const client = {
      uri,
      options,
      connect: jest.fn(async () => { if (mongoState.connectError) throw mongoState.connectError; }),
      close: jest.fn(async () => {}),
      db: jest.fn(() => ({
        collection: (name) => {
          if (!mongoState.collections.has(name)) mongoState.collections.set(name, new FakeCollection());
          return mongoState.collections.get(name);
        }
      }))
    };
    mongoState.clients.push(client);
    return client;
  })
}));

const MongoDBProvider = require('../../../src/dataservice/providers/dataserviceMongoDB');
const DocumentDBProvider = require('../../../src/dataservice/providers/dataserviceDocumentDB');

/** Lets the constructor's un-awaited connect settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe.each([
  ['mongodb', MongoDBProvider],
  ['documentdb', DocumentDBProvider]
])('%s provider', (type, Provider) => {
  let provider;
  let events;

  beforeEach(async () => {
    mongoState.collections.clear();
    mongoState.clients = [];
    mongoState.connectError = null;
    events = new EventEmitter();
    jest.spyOn(events, 'emit');
    provider = new Provider({ database: 'testdb' }, events);
    await flush();
  });

  it('connects on construction', () => {
    expect(provider.status).toBe('connected');
    expect(events.emit).toHaveBeenCalledWith(`api-dataservice-${type}:connected`, expect.any(Object));
  });

  it('creates containers with a uuid index once', async () => {
    await provider.createContainer('users');
    await provider.createContainer('users');
    expect(mongoState.collections.get('users').createIndex).toHaveBeenCalledTimes(1);
  });

  it('adds, reads, updates, finds, counts and removes documents', async () => {
    const id = await provider.add('users', { name: 'Ada', profile: { city: 'London' } });
    await provider.add('users', { name: 'Bob', profile: { city: 'Paris' } });

    expect(await provider.getByUuid('users', id)).toEqual({ name: 'Ada', profile: { city: 'London' } });
    expect(await provider.getByUuid('users', 'missing')).toBeNull();

    expect(await provider.update('users', id, { name: 'Ada L', profile: { city: 'London' } })).toBe(true);
    expect(await provider.update('users', 'missing', {})).toBe(false);

    expect(await provider.find('users', 'lond')).toEqual([{ name: 'Ada L', profile: { city: 'London' } }]);
    expect(await provider.find('users', 'a.b(')).toEqual([]);
    expect(await provider.listAll('users')).toHaveLength(2);
    expect(await provider.count('users')).toBe(2);

    expect(await provider.remove('users', id)).toBe(true);
    expect(await provider.remove('users', id)).toBe(false);
    expect(events.emit).toHaveBeenCalledWith(`api-dataservice-${type}:remove`, { containerName: 'users', objectKey: id });
  });

  it('wraps driver errors with the operation and container', async () => {
    const collection = new FakeCollection();
    mongoState.collections.set('broken', collection);
    const boom = async () => { throw new Error('driver failure'); };
    collection.insertOne = boom;
    collection.findOne = boom;
    collection.deleteOne = boom;
    collection.updateOne = boom;
    collection.replaceOne = boom;
    collection.countDocuments = boom;
    collection.find = () => ({ hasNext: boom });
    collection.createIndex = jest.fn(boom);

    await expect(provider.add('broken', {})).rejects.toThrow("Failed to add object to container 'broken': driver failure");
    await expect(provider.getByUuid('broken', 'x')).rejects.toThrow('Failed to retrieve');
    await expect(provider.remove('broken', 'x')).rejects.toThrow('Failed to remove');
    await expect(provider.update('broken', 'x', {})).rejects.toThrow('Failed to update');
    await expect(provider.count('broken')).rejects.toThrow('Failed to count');
    await expect(provider.find('broken', 'x')).rejects.toThrow('Failed to search');
    await expect(provider.createContainer('broken')).rejects.toThrow("Failed to create container 'broken'");
    expect(events.emit).toHaveBeenCalledWith(`api-dataservice-${type}:error`, expect.objectContaining({ operation: 'add' }));
  });

  it('reconnects lazily after close', async () => {
    await provider.close();
    expect(provider.status).toBe('disconnected');
    await provider.close();
    await provider.count('users');
    expect(provider.status).toBe('connected');
  });

  it('survives a failed startup connection and retries on the next operation', async () => {
    // The constructor connects without awaiting; a failure there used to be an
    // unhandled rejection, which app.js treats as fatal.
    mongoState.connectError = new Error('ECONNREFUSED');
    const failing = new Provider({}, events);
    await flush();
    expect(failing.status).toBe('disconnected');
    expect(events.emit).toHaveBeenCalledWith(`api-dataservice-${type}:error`, expect.objectContaining({ operation: 'connect' }));
    await expect(failing.count('x')).rejects.toThrow('connection failed: ECONNREFUSED');

    mongoState.connectError = null;
    expect(await failing.count('x')).toBe(0);
  });

  it('gets and saves settings', async () => {
    await provider.saveSettings({ queryTimeout: 5 });
    expect((await provider.getSettings()).queryTimeout).toBe(5);
  });
});

describe('DocumentDB connection string', () => {
  beforeEach(() => { mongoState.clients = []; mongoState.connectError = null; });

  it('builds credentials, SSL and retryWrites into the URI', async () => {
    new DocumentDBProvider({ host: 'docdb.test', port: 27017, username: 'u@x', password: 'p:w', ssl: true, database: 'db' });
    await flush();
    expect(mongoState.clients[0].uri).toBe('mongodb://u%40x:p%3Aw@docdb.test:27017/db?ssl=true&retryWrites=false');
  });

  it('uses an explicit connection string as-is', async () => {
    new DocumentDBProvider({ connectionString: 'mongodb://explicit' });
    await flush();
    expect(mongoState.clients[0].uri).toBe('mongodb://explicit');
  });

  it('falls back to a non-unique index when unique indexes fail', async () => {
    mongoState.collections.clear();
    const provider = new DocumentDBProvider({});
    await flush();
    const collection = new FakeCollection();
    collection.createIndex = jest.fn()
      .mockRejectedValueOnce(new Error('unique not supported'))
      .mockResolvedValueOnce('uuid_1');
    mongoState.collections.set('c', collection);
    await provider.createContainer('c');
    expect(collection.createIndex).toHaveBeenLastCalledWith({ uuid: 1 });
  });
});
