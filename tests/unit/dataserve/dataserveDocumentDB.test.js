/**
 * @fileoverview Unit tests for the DocumentDB dataserve functionality.
 * 
 * This test suite covers the DocumentDB dataserve provider, testing container creation,
 * object storage, retrieval, searching, and removal operations. Tests verify proper
 * DocumentDB integration and data persistence.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');
const createDataserve = require('../../../src/dataserve');

/**
 * Test suite for DocumentDB dataserve operations.
 * 
 * Tests the DocumentDB dataserve functionality including container management,
 * CRUD operations, search functionality, and error handling.
 * 
 * Note: These tests require a running DocumentDB instance at 127.0.0.1:10260
 * If DocumentDB is not available, tests will be skipped with appropriate warnings.
 */
describe('DocumentDB DataServe', () => {
  /** @type {Object} DocumentDB dataserve instance for testing */
  let dataserve;
  /** @type {EventEmitter} Mock event emitter for testing events */
  let mockEventEmitter;
  /** @type {string} Test container name */
  const testContainer = 'test_documentdb_container';
  /** @type {boolean} Whether DocumentDB is available for testing */
  let documentDBAvailable = false;

  /**
   * Set up test environment before all tests.
   * Creates a DocumentDB dataserve instance with test configuration.
   */
  beforeAll(async () => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    
    try {
      dataserve = createDataserve('documentdb', {
        host: '127.0.0.1',
        port: 10260,
        database: 'nooblyjs_test'
      }, mockEventEmitter);

      // Wait for connection attempt and test connectivity
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to create a test container to verify connection
      await dataserve.createContainer('connection_test');
      documentDBAvailable = true;
      console.log('✅ DocumentDB is available for testing');
    } catch (error) {
      console.warn('⚠️  DocumentDB not available for testing:', error.message);
      console.warn('   Make sure DocumentDB is running on port 10260 for full test coverage');
      documentDBAvailable = false;
    }
  });

  /**
   * Clean up test environment after all tests.
   * Removes test data and closes DocumentDB connection.
   */
  afterAll(async () => {
    if (dataserve && dataserve.provider && typeof dataserve.provider.close === 'function') {
      try {
        await dataserve.provider.close();
      } catch (error) {
        console.warn('Cleanup warning:', error.message);
      }
    }
  });

  /**
   * Set up test environment before each test case.
   * Ensures clean state for each test.
   */
  beforeEach(() => {
    if (mockEventEmitter && mockEventEmitter.emit) {
      mockEventEmitter.emit.mockClear();
    }
  });

  /**
   * Test DocumentDB availability.
   * 
   * This test checks if DocumentDB is available and provides guidance
   * if it's not running.
   */
  it('should report DocumentDB availability', () => {
    if (!documentDBAvailable) {
      console.log('📋 To run DocumentDB tests:');
      console.log('   1. Install DocumentDB locally');
      console.log('   2. Start DocumentDB on port 10260');
      console.log('   3. Re-run the tests');
    }
    
    expect(typeof documentDBAvailable).toBe('boolean');
  });

  /**
   * Test container creation.
   * 
   * Verifies that containers (DocumentDB collections) can be created successfully
   * and that appropriate events are emitted.
   */
  it('should create a container successfully', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping container creation test - DocumentDB not available');
      return;
    }

    const containerName = 'test_create_container';
    
    await dataserve.createContainer(containerName);
    
    // Verify container creation event was emitted
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'dataserve:createContainer',
      expect.objectContaining({ containerName })
    );
  });

  /**
   * Test object addition and retrieval.
   * 
   * Verifies that JSON objects can be stored in DocumentDB and retrieved
   * using their UUID keys.
   */
  it('should add and retrieve objects', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping add/retrieve test - DocumentDB not available');
      return;
    }

    const testObject = {
      username: 'docdb_johnsmith',
      fullname: 'John Smith (DocumentDB)',
      email: 'john.docdb@example.com',
      age: 30,
      type: 'test_user'
    };

    // Add object
    const objectKey = await dataserve.add(testContainer, testObject);
    
    expect(objectKey).toBeDefined();
    expect(typeof objectKey).toBe('string');
    
    // Verify add event was emitted
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'dataserve:add',
      expect.objectContaining({
        containerName: testContainer,
        objectKey,
        jsonObject: expect.objectContaining(testObject)
      })
    );

    // Retrieve object
    const retrieved = await dataserve.getByUuid(testContainer, objectKey);
    
    expect(retrieved).toEqual(testObject);
    
    // Clean up
    await dataserve.remove(testContainer, objectKey);
  }, 15000);

  /**
   * Test object searching.
   * 
   * Verifies that the find method can locate objects by searching
   * through their content using text matching.
   */
  it('should find objects by search term', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping search test - DocumentDB not available');
      return;
    }

    const testObjects = [
      { name: 'Alice DocumentDB', role: 'developer', department: 'engineering' },
      { name: 'Bob DocumentDB', role: 'designer', department: 'design' },
      { name: 'Charlie DocumentDB', role: 'manager', department: 'engineering' }
    ];

    // Add test objects
    const keys = [];
    for (const obj of testObjects) {
      const key = await dataserve.add(testContainer, obj);
      keys.push(key);
    }

    // Wait for DocumentDB to index the documents
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Search for objects
    const engineeringResults = await dataserve.find(testContainer, 'engineering');
    const designerResults = await dataserve.find(testContainer, 'designer');
    const documentDBResults = await dataserve.find(testContainer, 'DocumentDB');

    expect(engineeringResults.length).toBeGreaterThanOrEqual(2); // Alice and Charlie
    expect(designerResults.length).toBeGreaterThanOrEqual(1);    // Bob
    expect(documentDBResults.length).toBeGreaterThanOrEqual(3);  // All our test objects

    // Clean up
    for (const key of keys) {
      await dataserve.remove(testContainer, key);
    }
  }, 20000);

  /**
   * Test object removal.
   * 
   * Verifies that objects can be removed from DocumentDB collections
   * and that they are no longer retrievable afterwards.
   */
  it('should remove objects successfully', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping removal test - DocumentDB not available');
      return;
    }

    const testObject = { name: 'TempDocumentDBUser', temp: true };
    
    // Add object
    const objectKey = await dataserve.add(testContainer, testObject);
    
    // Verify object exists
    const beforeRemoval = await dataserve.getByUuid(testContainer, objectKey);
    expect(beforeRemoval).toEqual(testObject);
    
    // Remove object
    const removed = await dataserve.remove(testContainer, objectKey);
    expect(removed).toBe(true);
    
    // Verify remove event was emitted
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'dataserve:remove',
      expect.objectContaining({
        containerName: testContainer,
        objectKey
      })
    );
    
    // Verify object no longer exists
    const afterRemoval = await dataserve.getByUuid(testContainer, objectKey);
    expect(afterRemoval).toBeNull();
  }, 15000);

  /**
   * Test complex object storage.
   * 
   * Verifies that complex nested objects can be stored and retrieved
   * correctly from DocumentDB.
   */
  it('should handle complex nested objects', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping complex object test - DocumentDB not available');
      return;
    }

    const complexObject = {
      user: {
        profile: {
          name: 'Jane Doe DocumentDB',
          age: 28,
          preferences: {
            theme: 'dark',
            notifications: true,
            language: 'en'
          }
        },
        permissions: ['read', 'write', 'admin']
      },
      metadata: {
        created: new Date('2025-01-01').toISOString(),
        tags: ['important', 'user', 'documentdb'],
        source: 'test_suite'
      }
    };

    const objectKey = await dataserve.add(testContainer, complexObject);
    const retrieved = await dataserve.getByUuid(testContainer, objectKey);
    
    expect(retrieved).toEqual(complexObject);
    
    // Test searching within nested objects
    const searchResults = await dataserve.find(testContainer, 'documentdb');
    const foundObject = searchResults.find(obj => obj.metadata && obj.metadata.source === 'test_suite');
    expect(foundObject).toBeDefined();
    expect(foundObject.user.profile.preferences.theme).toBe('dark');
    
    // Clean up
    await dataserve.remove(testContainer, objectKey);
  }, 15000);

  /**
   * Test error handling for non-existent objects.
   * 
   * Verifies that retrieving non-existent objects returns null
   * and removing non-existent objects returns false.
   */
  it('should handle non-existent objects gracefully', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping error handling test - DocumentDB not available');
      return;
    }

    const fakeKey = 'non-existent-documentdb-uuid';
    
    // Try to get non-existent object
    const result = await dataserve.getByUuid(testContainer, fakeKey);
    expect(result).toBeNull();
    
    // Try to remove non-existent object
    const removed = await dataserve.remove(testContainer, fakeKey);
    expect(removed).toBe(false);
  });

  /**
   * Test JSON search functionality.
   * 
   * Verifies that the advanced JSON search methods work correctly
   * for finding objects by specific criteria.
   */
  it('should support advanced JSON search methods', async () => {
    if (!documentDBAvailable) {
      console.warn('⏭️  Skipping advanced search test - DocumentDB not available');
      return;
    }

    const testObjects = [
      { category: 'electronics', price: 100, inStock: true, source: 'documentdb' },
      { category: 'books', price: 20, inStock: false, source: 'documentdb' },
      { category: 'electronics', price: 200, inStock: true, source: 'documentdb' }
    ];

    // Add test objects
    const keys = [];
    for (const obj of testObjects) {
      const key = await dataserve.add(testContainer, obj);
      keys.push(key);
    }

    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test jsonFindByPath
    const electronicsItems = await dataserve.jsonFindByPath(testContainer, 'category', 'electronics');
    const documentDBItems = electronicsItems.filter(item => item.source === 'documentdb');
    expect(documentDBItems.length).toBe(2);
    
    // Test jsonFindByCriteria
    const inStockElectronics = await dataserve.jsonFindByCriteria(testContainer, {
      inStock: true,
      category: 'electronics',
      source: 'documentdb'
    });
    expect(inStockElectronics.length).toBe(2);
    
    // Clean up
    for (const key of keys) {
      await dataserve.remove(testContainer, key);
    }
  }, 20000);

  /**
   * Test provider connection info.
   * 
   * Verifies that the DocumentDB provider reports correct connection information.
   */
  it('should report connection information', () => {
    const connectionInfo = dataserve.provider.getConnectionInfo();
    
    expect(connectionInfo).toEqual({
      host: '127.0.0.1',
      port: 10260,
      database: 'nooblyjs_test',
      ssl: false,
      status: documentDBAvailable ? 'connected' : 'disconnected'
    });
  });

  /**
   * Test connection string building.
   * 
   * Verifies that connection strings are built correctly for various configurations.
   */
  it('should build connection strings correctly', () => {
    // Test with custom connection string
    const customDataserve = createDataserve('documentdb', {
      connectionString: 'mongodb://custom:27017/testdb?retryWrites=false'
    }, mockEventEmitter);
    
    expect(customDataserve.provider).toBeDefined();
    
    // Test with individual options
    const optionsDataserve = createDataserve('documentdb', {
      host: 'localhost',
      port: 27017,
      database: 'testdb',
      username: 'user',
      password: 'pass',
      ssl: true
    }, mockEventEmitter);
    
    expect(optionsDataserve.provider).toBeDefined();
  });
});