/**
 * @fileoverview Unit tests for the search service functionality.
 * 
 * This test suite covers the search service provider, testing JSON object
 * indexing, searching, and management. Tests verify proper data storage,
 * search functionality across nested objects, and event emission.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createSearchService = require('../../../src/searching');
const EventEmitter = require('events');

/**
 * Test suite for search service operations.
 * 
 * Tests the search service functionality including object indexing,
 * search operations, key management, and error handling.
 */
describe('SearchService', () => {
  /** @type {Object} Search service instance for testing */
  let searchService;
  /** @type {EventEmitter} Mock event emitter for testing search events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh search service instance and event emitter spy.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    searchService = createSearchService('default', {}, mockEventEmitter);
  });

  /**
   * Test adding JSON objects with unique keys.
   * 
   * Verifies that objects can be added with unique keys and that
   * duplicate key attempts are properly handled with error events.
   */
  it('should add a JSON object with a unique key', async () => {
    const key1 = 'key1';
    const obj1 = { id: 1, name: 'Test Object 1' };
    expect(await searchService.add(key1, obj1)).toBe(true);
    expect(searchService.data.size).toBe(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:add', {
      jsonObject: obj1,
    });

    // Try adding with the same key, should return false
    mockEventEmitter.emit.mockClear();
    expect(await searchService.add(key1, { id: 2, name: 'Another Object' })).toBe(
      false,
    );
    expect(searchService.data.size).toBe(1); // Size should remain 1
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:add:error', {
      jsonObject: { id: 2, name: 'Another Object' },
      key: 'key1',
      error: 'Key already exists.',
    });
  });

  /**
   * Test removing JSON objects by key.
   * 
   * Verifies that objects can be removed by their keys and that
   * removal of non-existent keys is handled gracefully.
   */
  it('should remove a JSON object by its key', async () => {
    const key1 = 'key1';
    const obj1 = { id: 1, name: 'Test Object 1' };
    const key2 = 'key2';
    const obj2 = { id: 2, name: 'Test Object 2' };

    await searchService.add(key1, obj1);
    await searchService.add(key2, obj2);
    expect(searchService.data.size).toBe(2);

    mockEventEmitter.emit.mockClear();
    expect(await searchService.remove(key1)).toBe(true);
    expect(searchService.data.has(key1)).toBe(false);
    expect(searchService.data.size).toBe(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:remove', {
      key: key1,
    });

    // Try removing a non-existent key, should return false
    mockEventEmitter.emit.mockClear();
    expect(await searchService.remove('nonExistentKey')).toBe(false);
    expect(searchService.data.size).toBe(1);
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('search:remove', {
      key: 'nonExistentKey',
    });
  });

  /**
   * Test case-insensitive search across all string values.
   * 
   * Verifies that search works across all string values in objects,
   * including nested objects, with case-insensitive matching.
   */
  it('should search for a term across all string values (case-insensitive)', async () => {
    const obj1 = { id: 1, name: 'Apple', description: 'A red fruit.' };
    const obj2 = { id: 2, name: 'Banana', description: 'A yellow fruit.' };
    const obj3 = { id: 3, name: 'Cherry', description: 'A small red fruit.' };
    const obj4 = {
      id: 4,
      name: 'Date',
      details: { color: 'brown', taste: 'sweet' },
    };

    await searchService.add('obj1', obj1);
    await searchService.add('obj2', obj2);
    await searchService.add('obj3', obj3);
    await searchService.add('obj4', obj4);

    mockEventEmitter.emit.mockClear();
    // Search for 'fruit' (case-insensitive)
    let results = await searchService.search('fruit');
    expect(results).toEqual(expect.arrayContaining([
      {key: 'obj1', obj: obj1},
      {key: 'obj2', obj: obj2},
      {key: 'obj3', obj: obj3}
    ]));
    expect(results.length).toBe(3);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'fruit',
      results,
    });

    mockEventEmitter.emit.mockClear();
    // Search for 'red'
    results = await searchService.search('red');
    expect(results).toEqual(expect.arrayContaining([{key: 'obj1', obj: obj1}, {key: 'obj3', obj: obj3}]));
    expect(results.length).toBe(2);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'red',
      results,
    });

    mockEventEmitter.emit.mockClear();
    // Search for 'yellow'
    results = await searchService.search('yellow');
    expect(results).toEqual(expect.arrayContaining([{key: 'obj2', obj: obj2}]));
    expect(results.length).toBe(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'yellow',
      results,
    });

    mockEventEmitter.emit.mockClear();
    // Search for a term that doesn't exist
    results = await searchService.search('grape');
    expect(results).toEqual([]);
    expect(results.length).toBe(0);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'grape',
      results: [],
    });

    mockEventEmitter.emit.mockClear();
    // Search for a term in a nested object
    results = await searchService.search('brown');
    expect(results).toEqual(expect.arrayContaining([{key: 'obj4', obj: obj4}]));
    expect(results.length).toBe(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'brown',
      results,
    });

    // Search for a term that is part of a key, not a value
    const obj5 = { id: 5, fruitName: 'Orange' };
    await searchService.add('obj5', obj5);
    mockEventEmitter.emit.mockClear();
    results = await searchService.search('fruitName');
    expect(results).toEqual([]);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'fruitName',
      results: [],
    });
  });

  /**
   * Test search behavior with empty index.
   * 
   * Verifies that searching returns empty results when no objects
   * have been added to the search index.
   */
  it('should return an empty array if no objects are added', async () => {
    mockEventEmitter.emit.mockClear();
    const results = await searchService.search('anything');
    expect(results).toEqual([]);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: 'anything',
      results: [],
    });
  });

  /**
   * Test search behavior with empty search term.
   * 
   * Verifies that empty search terms return no results and are
   * handled gracefully without errors.
   */
  it('should handle empty search term', async () => {
    const obj1 = { id: 1, name: 'Test Object 1' };
    await searchService.add('obj1', obj1);
    mockEventEmitter.emit.mockClear();
    const results = await searchService.search('');
    expect(results).toEqual([]);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('search:search', {
      searchTerm: '',
      results: [],
    });
  });
});
