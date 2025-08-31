/**
 * @fileoverview Unit tests for the MongoDB dataserve functionality.
 * 
 * This test suite covers the MongoDB dataserve provider, testing container creation,
 * object storage, retrieval, searching, and removal operations. Tests verify proper
 * MongoDB integration and data persistence.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');
const createDataserve = require('../../../src/dataserve');

/**
 * Test suite for MongoDB dataserve operations.
 * 
 * Tests the MongoDB dataserve functionality including container management,
 * CRUD operations, search functionality, and error handling.
 * 
 * Note: These tests require a running MongoDB instance at mongodb://127.0.0.1:27017
 */
describe('MongoDB DataServe', () => {
  /** @type {Object} MongoDB dataserve instance for testing */
  let dataserve;
  /** @type {EventEmitter} Mock event emitter for testing events */
  let mockEventEmitter;
  /** @type {string} Test container name */
  const testContainer = 'test_mongodb_container';

  /**
   * Set up test environment before all tests.
   * Creates a MongoDB dataserve instance with test configuration.
   */
  beforeAll(async () => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    
    dataserve = createDataserve('mongodb', {
      database: 'nooblyjs_test',
      connectionString: 'mongodb://127.0.0.1:27017'
    }, mockEventEmitter);

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  /**
   * Clean up test environment after all tests.
   * Removes test data and closes MongoDB connection.
   */
  afterAll(async () => {
    if (dataserve && dataserve.provider && typeof dataserve.provider.close === 'function') {
      try {
        // Clean up test container
        const allObjects = await dataserve.find(testContainer, '');
        for (const obj of allObjects) {
          // Find the object key by searching for it
          const searchResults = await dataserve.find(testContainer, obj.username || 'test');
          if (searchResults.length > 0) {
            // This is a simplified cleanup - in real scenarios you'd need the actual UUID
            // For now, we'll let MongoDB handle cleanup via database drop
          }
        }
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
  beforeEach(async () => {
    try {
      // Create test container
      await dataserve.createContainer(testContainer);
    } catch (error) {
      // Container might already exist, which is fine
    }
    mockEventEmitter.emit.mockClear();
  });

  /**
   * Test container creation.
   * 
   * Verifies that containers (MongoDB collections) can be created successfully
   * and that appropriate events are emitted.
   */
  it('should create a container successfully', async () => {
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
   * Verifies that JSON objects can be stored in MongoDB and retrieved
   * using their UUID keys.
   */
  it('should add and retrieve objects', async () => {
    const testObject = {
      username: 'johnsmith',
      fullname: 'John Smith',
      email: 'john@example.com',
      age: 30
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
  }, 10000);

  /**
   * Test object searching.
   * 
   * Verifies that the find method can locate objects by searching
   * through their content using text matching.
   */
  it('should find objects by search term', async () => {
    const testObjects = [
      { name: 'Alice', role: 'developer', department: 'engineering' },
      { name: 'Bob', role: 'designer', department: 'design' },
      { name: 'Charlie', role: 'manager', department: 'engineering' }
    ];

    // Add test objects
    const keys = [];
    for (const obj of testObjects) {
      const key = await dataserve.add(testContainer, obj);
      keys.push(key);
    }

    // Search for objects
    const engineeringResults = await dataserve.find(testContainer, 'engineering');
    const designerResults = await dataserve.find(testContainer, 'designer');
    const allResults = await dataserve.find(testContainer, '');

    expect(engineeringResults.length).toBe(2); // Alice and Charlie
    expect(designerResults.length).toBe(1);    // Bob
    expect(allResults.length).toBeGreaterThanOrEqual(3); // At least our test objects

    // Clean up
    for (const key of keys) {
      await dataserve.remove(testContainer, key);
    }
  }, 15000);

  /**
   * Test object removal.
   * 
   * Verifies that objects can be removed from MongoDB collections
   * and that they are no longer retrievable afterwards.
   */
  it('should remove objects successfully', async () => {
    const testObject = { name: 'TempUser', temp: true };
    
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
  }, 10000);

  /**
   * Test complex object storage.
   * 
   * Verifies that complex nested objects can be stored and retrieved
   * correctly from MongoDB.
   */
  it('should handle complex nested objects', async () => {
    const complexObject = {
      user: {
        profile: {
          name: 'Jane Doe',
          age: 28,
          preferences: {
            theme: 'dark',
            notifications: true
          }
        },
        permissions: ['read', 'write', 'admin']
      },
      metadata: {
        created: new Date('2025-01-01').toISOString(),
        tags: ['important', 'user']
      }
    };

    const objectKey = await dataserve.add(testContainer, complexObject);
    const retrieved = await dataserve.getByUuid(testContainer, objectKey);
    
    expect(retrieved).toEqual(complexObject);
    
    // Test searching within nested objects
    const searchResults = await dataserve.find(testContainer, 'dark');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].user.profile.preferences.theme).toBe('dark');
    
    // Clean up
    await dataserve.remove(testContainer, objectKey);
  }, 10000);

  /**
   * Test error handling for non-existent objects.
   * 
   * Verifies that retrieving non-existent objects returns null
   * and removing non-existent objects returns false.
   */
  it('should handle non-existent objects gracefully', async () => {
    const fakeKey = 'non-existent-uuid';
    
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
    const testObjects = [
      { category: 'electronics', price: 100, inStock: true },
      { category: 'books', price: 20, inStock: false },
      { category: 'electronics', price: 200, inStock: true }
    ];

    // Add test objects
    const keys = [];
    for (const obj of testObjects) {
      const key = await dataserve.add(testContainer, obj);
      keys.push(key);
    }

    // Test jsonFindByPath
    const electronicsItems = await dataserve.jsonFindByPath(testContainer, 'category', 'electronics');
    expect(electronicsItems.length).toBe(2);
    
    // Test jsonFindByCriteria
    const expensiveInStockItems = await dataserve.jsonFindByCriteria(testContainer, {
      inStock: true,
      category: 'electronics'
    });
    expect(expensiveInStockItems.length).toBe(2);
    
    // Clean up
    for (const key of keys) {
      await dataserve.remove(testContainer, key);
    }
  }, 15000);

  /**
   * Test provider status.
   * 
   * Verifies that the MongoDB provider reports correct connection status.
   */
  it('should report connection status', () => {
    expect(dataserve.provider.status).toBe('connected');
  });
});