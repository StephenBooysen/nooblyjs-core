/**
 * @fileoverview Unit tests for the AWS SimpleDB DataRing provider.
 */



const AWS = require('aws-sdk');
const EventEmitter = require('events');

// Mock the AWS SimpleDB client
jest.mock('aws-sdk', () => {
  const mockSimpleDB = {
    createDomain: jest.fn().mockReturnThis(),
    putAttributes: jest.fn().mockReturnThis(),
    deleteAttributes: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    promise: jest.fn(),
  };
  return {
    SimpleDB: jest.fn(() => mockSimpleDB),
    config: {
      update: jest.fn(),
    },
  };
});

describe('SimpleDbDataRingProvider', () => {
  const mockRegion = 'us-east-1';
  const mockAccessKeyId = 'test-access-key';
  const mockSecretAccessKey = 'test-secret-key';
  const mockDomainName = 'test-domain';

  let simpleDbProvider;
  let mockSdbInstance;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    jest.clearAllMocks();
    simpleDbProvider = new SimpleDbDataRingProvider(
      {
        region: mockRegion,
        accessKeyId: mockAccessKeyId,
        secretAccessKey: mockSecretAccessKey,
      },
      mockEventEmitter,
    );
    mockSdbInstance = simpleDbProvider.sdb;
  });

  it('should initialize with correct SimpleDB configuration', () => {
    expect(AWS.config.update).toHaveBeenCalledWith({
      region: mockRegion,
      accessKeyId: mockAccessKeyId,
      secretAccessKey: mockSecretAccessKey,
    });
    expect(AWS.SimpleDB).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if region is missing', () => {
    expect(() => new SimpleDbDataRingProvider({})).toThrow(
      'SimpleDbDataRingProvider requires region in options.',
    );
  });

  describe('createContainer', () => {
    it('should create a SimpleDB domain', async () => {
      mockSdbInstance.createDomain().promise.mockResolvedValueOnce({});
      await simpleDbProvider.createContainer(mockDomainName);
      expect(mockSdbInstance.createDomain).toHaveBeenCalledWith({
        DomainName: mockDomainName,
      });
      expect(mockSdbInstance.createDomain().promise).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'dataservice:createContainer',
        { domainName: mockDomainName },
      );
    });
  });

  describe('add', () => {
    it('should add a JSON object to a SimpleDB domain', async () => {
      mockSdbInstance.putAttributes().promise.mockResolvedValueOnce({});
      const jsonObject = { name: 'TestItem', value: 123 };
      const itemName = await simpleDbProvider.add(mockDomainName, jsonObject);

      expect(mockSdbInstance.putAttributes).toHaveBeenCalledWith({
        DomainName: mockDomainName,
        ItemName: expect.any(String),
        Attributes: [
          { Name: 'name', Value: 'TestItem', Replace: true },
          { Name: 'value', Value: '123', Replace: true },
        ],
      });
      expect(mockSdbInstance.putAttributes().promise).toHaveBeenCalledTimes(1);
      expect(typeof itemName).toBe('string');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('dataservice:add', {
        domainName: mockDomainName,
        itemName: itemName,
        jsonObject: jsonObject,
      });
    });
  });

  describe('remove', () => {
    it('should remove a JSON object from a SimpleDB domain', async () => {
      mockSdbInstance.deleteAttributes().promise.mockResolvedValueOnce({});
      const objectKey = 'some-item-key';
      const result = await simpleDbProvider.remove(mockDomainName, objectKey);

      expect(mockSdbInstance.deleteAttributes).toHaveBeenCalledWith({
        DomainName: mockDomainName,
        ItemName: objectKey,
      });
      expect(mockSdbInstance.deleteAttributes().promise).toHaveBeenCalledTimes(
        1,
      );
      expect(result).toBe(true);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('dataservice:remove', {
        domainName: mockDomainName,
        objectKey: objectKey,
      });
    });

    it('should return false if deletion fails', async () => {
      mockSdbInstance
        .deleteAttributes()
        .promise.mockRejectedValueOnce(new Error('Deletion failed'));
      const objectKey = 'some-item-key';
      const result = await simpleDbProvider.remove(mockDomainName, objectKey);
      expect(result).toBe(false);
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'dataservice:remove',
        expect.any(Object),
      );
    });
  });

  describe('find', () => {
    it('should find JSON objects in a SimpleDB domain', async () => {
      const sdbItems = [
        {
          Name: 'item1',
          Attributes: [
            { Name: 'name', Value: 'Laptop' },
            { Name: 'category', Value: 'Electronics' },
          ],
        },
        {
          Name: 'item2',
          Attributes: [
            { Name: 'name', Value: 'Keyboard' },
            { Name: 'category', Value: 'Electronics' },
          ],
        },
      ];
      mockSdbInstance
        .select()
        .promise.mockResolvedValueOnce({ Items: sdbItems });

      const searchTerm = 'Electronics';
      const results = await simpleDbProvider.find(mockDomainName, searchTerm);

      expect(mockSdbInstance.select).toHaveBeenCalledWith({
        SelectExpression:
          'SELECT * FROM `' +
          mockDomainName +
          (('` WHERE itemName() LIKE ' % ' + searchTerm + ') % ''),
      });
      expect(results).toEqual([
        { itemName: 'item1', name: 'Laptop', category: 'Electronics' },
        { itemName: 'item2', name: 'Keyboard', category: 'Electronics' },
      ]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('dataservice:find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: results,
      });
    });

    it('should return an empty array if no items are found', async () => {
      mockSdbInstance.select().promise.mockResolvedValueOnce({ Items: [] });
      const searchTerm = 'NonExistent';
      const results = await simpleDbProvider.find(mockDomainName, searchTerm);
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('dataservice:find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: [],
      });
    });

    it('should return an empty array if Items is undefined', async () => {
      mockSdbInstance.select().promise.mockResolvedValueOnce({});
      const searchTerm = 'NonExistent';
      const results = await simpleDbProvider.find(mockDomainName, searchTerm);
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('dataservice:find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: [],
      });
    });
  });
});
