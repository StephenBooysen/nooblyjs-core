/**
 * @fileoverview Unit tests for the DataService and its providers.
 */

// Mock the AWS SimpleDB client FIRST before any imports
const mockPromise = jest.fn();
const mockSimpleDB = {
  createDomain: jest.fn().mockReturnValue({ promise: mockPromise }),
  putAttributes: jest.fn().mockReturnValue({ promise: mockPromise }),
  deleteAttributes: jest.fn().mockReturnValue({ promise: mockPromise }),
  select: jest.fn().mockReturnValue({ promise: mockPromise }),
};
const mockConfig = {
  update: jest.fn(),
};
const mockSimpleDBConstructor = jest.fn(() => mockSimpleDB);

jest.mock('aws-sdk', () => ({
  SimpleDB: mockSimpleDBConstructor,
  config: mockConfig,
}));

// Now import other modules
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const AWS = require('aws-sdk');
const createDataServiceService = require('../../../src/dataservice');

describe('DataService', () => {
  // Test InMemoryDataServiceProvider
  describe('InMemoryDataServiceProvider', () => {
    let dataService;
    let mockEventEmitter;

    beforeEach(() => {
      mockEventEmitter = new EventEmitter();
      jest.spyOn(mockEventEmitter, 'emit');
      dataService = createDataServiceService('memory', {}, mockEventEmitter);
    });

    it('should create a container', async () => {
      await dataService.createContainer('products');
      expect(dataService.provider.containers.has('products')).toBe(true);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'api-dataservice-createContainer',
        { containerName: 'products' },
      );
    });

    it('should throw error if container already exists', async () => {
      await dataService.createContainer('products');
      await expect(
        dataService.createContainer('products'),
      ).rejects.toThrow("Container 'products' already exists.");
    });

    it('should add an object to a container and return a key', async () => {
      await dataService.createContainer('users');
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const user = { name: 'Alice', email: 'alice@example.com' };
      const key = await dataService.add('users', user);
      expect(typeof key).toBe('string');
      expect(
        dataService.provider.containers.get('users').get(key),
      ).toEqual(user);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-add', {
        containerName: 'users',
        objectKey: key,
        jsonObject: user,
      });
    });

    it('should remove an object from a container by key', async () => {
      await dataService.createContainer('users');
      const user = { name: 'Bob', email: 'bob@example.com' };
      const key = await dataService.add('users', user);
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const removed = await dataService.remove('users', key);
      expect(removed).toBe(true);
      expect(dataService.provider.containers.get('users').has(key)).toBe(
        false,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-remove', {
        containerName: 'users',
        objectKey: key,
      });
    });

    it('should return false if removing non-existent object', async () => {
      await dataService.createContainer('users');
      const removed = await dataService.remove('users', 'nonExistentKey');
      expect(removed).toBe(false);
    });

    it('should find objects in a container by search term', async () => {
      await dataService.createContainer('products');
      await dataService.add('products', {
        name: 'Laptop',
        category: 'Electronics',
      });
      await dataService.add('products', {
        name: 'Keyboard',
        category: 'Electronics',
      });
      await dataService.add('products', {
        name: 'Mouse',
        category: 'Peripherals',
      });
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const results = await dataService.find('products', 'electronics');
      expect(results.length).toBe(2);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Laptop' }),
          expect.objectContaining({ name: 'Keyboard' }),
        ]),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        containerName: 'products',
        searchTerm: 'electronics',
        results,
      });
    });

    it('should return empty array if no matching objects found', async () => {
      await dataService.createContainer('products');
      await dataService.add('products', {
        name: 'Laptop',
        category: 'Electronics',
      });
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const results = await dataService.find('products', 'nonexistent');
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        containerName: 'products',
        searchTerm: 'nonexistent',
        results: [],
      });
    });

    it('should throw error if adding to non-existent container', async () => {
      const user = { name: 'Alice' };
      await expect(
        dataService.add('nonExistentContainer', user),
      ).rejects.toThrow("Container 'nonExistentContainer' does not exist.");
    });
  });

  // Test FileDataRingProvider
  describe('FileDataRingProvider', () => {
    const testBaseDir = path.join(__dirname, 'test_dataservice_data');
    let dataService;
    let mockEventEmitter;

    beforeEach(async () => {
      mockEventEmitter = new EventEmitter();
      jest.spyOn(mockEventEmitter, 'emit');
      await fs
        .rm(testBaseDir, { recursive: true, force: true })
        .catch(() => {}); // Clean up before each test
      dataService = createDataServiceService(
        'file',
        { baseDir: testBaseDir },
        mockEventEmitter,
      );
    });

    afterAll(async () => {
      await fs.rm(testBaseDir, { recursive: true, force: true }); // Clean up after all tests
    });

    it('should create a container file', async () => {
      await dataService.createContainer('orders');
      const containerFilePath = path.join(testBaseDir, 'orders.json');
      await expect(fs.access(containerFilePath)).resolves.toBeUndefined();
      const content = await fs.readFile(containerFilePath, 'utf8');
      expect(content).toBe('{}');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'api-dataservice-createContainer',
        { containerName: 'orders' },
      );
    });

    it('should throw error if container file already exists', async () => {
      await dataService.createContainer('orders');
      await expect(dataService.createContainer('orders')).rejects.toThrow(
        "Container 'orders' already exists.",
      );
    });

    it('should add an object to a container file and return a key', async () => {
      await dataService.createContainer('products');
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const product = { name: 'Book', price: 20 };
      const key = await dataService.add('products', product);
      expect(typeof key).toBe('string');
      const content = await fs.readFile(
        path.join(testBaseDir, 'products.json'),
        'utf8',
      );
      const data = JSON.parse(content);
      expect(data[key]).toEqual(product);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-add', {
        containerName: 'products',
        objectKey: key,
        jsonObject: product,
      });
    });

    it('should remove an object from a container file by key', async () => {
      await dataService.createContainer('products');
      const product = { name: 'Pen', price: 1 };
      const key = await dataService.add('products', product);
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const removed = await dataService.remove('products', key);
      expect(removed).toBe(true);
      const content = await fs.readFile(
        path.join(testBaseDir, 'products.json'),
        'utf8',
      );
      const data = JSON.parse(content);
      expect(data[key]).toBeUndefined();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-remove', {
        containerName: 'products',
        objectKey: key,
      });
    });

    it('should return false if removing non-existent object from file', async () => {
      await dataService.createContainer('products');
      const removed = await dataService.remove(
        'products',
        'nonExistentKey',
      );
      expect(removed).toBe(false);
    });

    it('should find objects in a container file by search term', async () => {
      await dataService.createContainer('items');
      await dataService.add('items', { name: 'Table', material: 'Wood' });
      await dataService.add('items', {
        name: 'Chair',
        material: 'Plastic',
      });
      await dataService.add('items', { name: 'Desk', material: 'Wood' });
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const results = await dataService.find('items', 'wood');
      expect(results.length).toBe(2);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Table' }),
          expect.objectContaining({ name: 'Desk' }),
        ]),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        containerName: 'items',
        searchTerm: 'wood',
        results,
      });
    });

    it('should return empty array if no matching objects found in file', async () => {
      await dataService.createContainer('items');
      await dataService.add('items', { name: 'Table', material: 'Wood' });
      mockEventEmitter.emit.mockClear(); // Clear previous emits
      const results = await dataService.find('items', 'metal');
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        containerName: 'items',
        searchTerm: 'metal',
        results: [],
      });
    });

    it('should handle adding to a container that was not explicitly created but exists as a file', async () => {
      const containerFilePath = path.join(
        testBaseDir,
        'implicitContainer.json',
      );
      await fs.mkdir(path.dirname(containerFilePath), { recursive: true });
      await fs.writeFile(containerFilePath, JSON.stringify({}, null, 2));

      const item = { id: 1, value: 'test' };
      const key = await dataService.add('implicitContainer', item);
      expect(typeof key).toBe('string');
      const content = await fs.readFile(containerFilePath, 'utf8');
      const data = JSON.parse(content);
      expect(data[key]).toEqual(item);
    });
  });

  // Test SimpleDbDataRingProvider
  describe('SimpleDbDataRingProvider', () => {
    const mockRegion = 'us-east-1';
    const mockAccessKeyId = 'test-access-key';
    const mockSecretAccessKey = 'test-secret-key';
    const mockDomainName = 'test-domain';

    let simpleDbDataService;
    let mockSdbInstance;
    let mockEventEmitter;

    beforeEach(() => {
      mockEventEmitter = new EventEmitter();
      jest.spyOn(mockEventEmitter, 'emit');
      
      // Reset AWS mocks before each test
      mockConfig.update.mockClear();
      mockPromise.mockClear();
      mockSimpleDBConstructor.mockClear();
      mockSimpleDB.createDomain.mockClear();
      mockSimpleDB.putAttributes.mockClear();
      mockSimpleDB.deleteAttributes.mockClear();
      mockSimpleDB.select.mockClear();
      
      simpleDbDataService = createDataServiceService(
        'simpledb',
        {
          region: mockRegion,
          accessKeyId: mockAccessKeyId,
          secretAccessKey: mockSecretAccessKey,
        },
        mockEventEmitter,
      );
      mockSdbInstance = simpleDbDataService.provider.sdb;
    });

    it('should initialize with correct SimpleDB configuration', () => {
      // Verify the service was created with SimpleDB provider
      expect(simpleDbDataService.provider).toBeDefined();
      expect(simpleDbDataService.provider.sdb).toBeDefined();
      
      expect(mockConfig.update).toHaveBeenCalledWith({
        region: mockRegion,
        accessKeyId: mockAccessKeyId,
        secretAccessKey: mockSecretAccessKey,
      });
      expect(mockSimpleDBConstructor).toHaveBeenCalledTimes(1);
    });

    it('should create a SimpleDB domain', async () => {
      mockPromise.mockResolvedValueOnce({});
      await simpleDbDataService.createContainer(mockDomainName);
      expect(mockSdbInstance.createDomain).toHaveBeenCalledWith({
        DomainName: mockDomainName,
      });
      expect(mockPromise).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'api-dataservice-createContainer',
        { domainName: mockDomainName },
      );
    });

    it('should add a JSON object to a SimpleDB domain', async () => {
      mockPromise.mockResolvedValueOnce({});
      const jsonObject = { name: 'TestItem', value: 123 };
      const itemName = await simpleDbDataService.add(
        mockDomainName,
        jsonObject,
      );

      expect(mockSdbInstance.putAttributes).toHaveBeenCalledWith({
        DomainName: mockDomainName,
        ItemName: expect.any(String),
        Attributes: [
          { Name: 'name', Value: 'TestItem', Replace: true },
          { Name: 'value', Value: '123', Replace: true },
        ],
      });
      expect(mockPromise).toHaveBeenCalledTimes(1);
      expect(typeof itemName).toBe('string');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-add', {
        domainName: mockDomainName,
        itemName: itemName,
        jsonObject: jsonObject,
      });
    });

    it('should remove a JSON object from a SimpleDB domain', async () => {
      mockPromise.mockResolvedValueOnce({});
      const objectKey = 'some-item-key';
      const result = await simpleDbDataService.remove(
        mockDomainName,
        objectKey,
      );

      expect(mockSdbInstance.deleteAttributes).toHaveBeenCalledWith({
        DomainName: mockDomainName,
        ItemName: objectKey,
      });
      expect(mockPromise).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-remove', {
        domainName: mockDomainName,
        objectKey: objectKey,
      });
    });

    it('should return false if deletion fails', async () => {
      mockPromise.mockRejectedValueOnce(new Error('Deletion failed'));
      const objectKey = 'some-item-key';
      const result = await simpleDbDataService.remove(
        mockDomainName,
        objectKey,
      );
      expect(result).toBe(false);
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'api-dataservice-remove',
        expect.any(Object),
      );
    });

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
      mockPromise.mockResolvedValueOnce({ Items: sdbItems });

      const searchTerm = 'Electronics';
      const results = await simpleDbDataService.find(
        mockDomainName,
        searchTerm,
      );

      expect(mockSdbInstance.select).toHaveBeenCalledWith({
        SelectExpression:
          'SELECT * FROM `' +
          mockDomainName +
          '` WHERE itemName() LIKE \'%' + searchTerm + '%\'',
      });
      expect(results).toEqual([
        { itemName: 'item1', name: 'Laptop', category: 'Electronics' },
        { itemName: 'item2', name: 'Keyboard', category: 'Electronics' },
      ]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: results,
      });
    });

    it('should return an empty array if no items are found', async () => {
      mockPromise.mockResolvedValueOnce({ Items: [] });
      const searchTerm = 'NonExistent';
      const results = await simpleDbDataService.find(
        mockDomainName,
        searchTerm,
      );
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: [],
      });
    });

    it('should return an empty array if Items is undefined', async () => {
      mockPromise.mockResolvedValueOnce({});
      const searchTerm = 'NonExistent';
      const results = await simpleDbDataService.find(
        mockDomainName,
        searchTerm,
      );
      expect(results).toEqual([]);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('api-dataservice-find', {
        domainName: mockDomainName,
        searchTerm: searchTerm,
        results: [],
      });
    });
  });
});
