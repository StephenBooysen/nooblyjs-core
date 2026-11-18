/**
 * @fileoverview Unit tests for the API-based data service functionality.
 *
 * This test suite covers the API data service provider that connects to remote backend services.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const createDataService = require('../../../src/dataservice');
const EventEmitter = require('events');
const nock = require('nock');

describe('DataService API Provider', () => {
  let dataService;
  let mockEventEmitter;
  const apiRoot = 'http://backend.example.com';
  const apiKey = 'test-api-key-12345';

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    dataService = createDataService('api', {
      api: apiRoot,
      apiKey,
      timeout: 10000
    }, mockEventEmitter);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should create a record via API', async () => {
    const testData = { name: 'John Doe', email: 'john@example.com' };
    const expectedResponse = { id: 'uuid-12345' };

    nock(apiRoot)
      .post('/services/dataservice/api/users', testData)
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedResponse);

    const result = await dataService.provider.create('users', testData);

    expect(result).toEqual(expectedResponse);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('data:create', {
      collection: 'users',
      data: expectedResponse
    });
  });

  it('should read records via API', async () => {
    const expectedData = [
      { id: '1', name: 'User 1' },
      { id: '2', name: 'User 2' }
    ];

    nock(apiRoot)
      .get('/services/dataservice/api/users')
      .query({ status: 'active' })
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedData);

    const result = await dataService.provider.read('users', { status: 'active' });

    expect(result).toEqual(expectedData);
  });

  it('should read a single record by ID via API', async () => {
    const recordId = 'uuid-12345';
    const expectedData = { id: recordId, name: 'John Doe' };

    nock(apiRoot)
      .get(`/services/dataservice/api/users/${recordId}`)
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedData);

    const result = await dataService.provider.readById('users', recordId);

    expect(result).toEqual(expectedData);
  });

  it('should update a record via API', async () => {
    const recordId = 'uuid-12345';
    const updates = { name: 'Jane Doe' };
    const expectedResponse = { id: recordId, ...updates };

    nock(apiRoot)
      .put(`/services/dataservice/api/users/${recordId}`, updates)
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedResponse);

    const result = await dataService.provider.update('users', recordId, updates);

    expect(result).toEqual(expectedResponse);
  });

  it('should delete a record via API', async () => {
    const recordId = 'uuid-12345';

    nock(apiRoot)
      .delete(`/services/dataservice/api/users/${recordId}`)
      .matchHeader('X-API-Key', apiKey)
      .reply(200);

    await dataService.provider.delete('users', recordId);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('data:delete', {
      collection: 'users',
      id: recordId
    });
  });

  it('should execute queries via API', async () => {
    const query = { status: 'active', role: 'admin' };
    const expectedResults = [{ id: '1', name: 'Admin User' }];

    nock(apiRoot)
      .post('/services/dataservice/api/users/query', { query })
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedResults);

    const result = await dataService.provider.query('users', query);

    expect(result).toEqual(expectedResults);
  });

  it('should handle API errors properly', async () => {
    nock(apiRoot)
      .get('/services/dataservice/api/users/nonexistent')
      .matchHeader('X-API-Key', apiKey)
      .reply(404, 'Not Found');

    await expect(dataService.provider.readById('users', 'nonexistent')).rejects.toThrow();
  });
});
