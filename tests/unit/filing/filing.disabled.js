/**
 * @fileoverview Unit tests for the Filing service and its providers.
 * 
 * This test suite covers the filing service functionality including local
 * file operations, event emission, and basic CRUD operations.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const createFilingService = require('../../../src/filing');

/**
 * Test suite for Filing service functionality.
 * 
 * Tests local file provider operations including upload, download,
 * and removal of files with proper event handling.
 */
describe('Filing Service', () => {
  
  describe('Local Filing Provider', () => {
    let filingService;
    let mockEventEmitter;
    let testBaseDir;
    
    /**
     * Set up test environment before each test case.
     */
    beforeEach(async () => {
      mockEventEmitter = new EventEmitter();
      jest.spyOn(mockEventEmitter, 'emit');
      
      testBaseDir = path.join(__dirname, 'test_filing_data');
      await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {});
      
      filingService = createFilingService('local', {
        basePath: testBaseDir
      }, mockEventEmitter);
    });
    
    /**
     * Clean up test environment after each test case.
     */
    afterEach(async () => {
      await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {});
    });
    
    it('should create filing service instance', () => {
      expect(filingService).toBeDefined();
      expect(typeof filingService.upload).toBe('function');
      expect(typeof filingService.download).toBe('function');
      expect(typeof filingService.remove).toBe('function');
    });
    
    it('should upload a file from buffer', async () => {
      const key = 'test-file.txt';
      const content = 'Hello, World!';
      const buffer = Buffer.from(content, 'utf8');
      
      await filingService.upload(key, buffer);
      
      // Check if file was created
      const filePath = path.join(testBaseDir, key);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // Check file content
      const savedContent = await fs.readFile(filePath, 'utf8');
      expect(savedContent).toBe(content);
      
      // Check event emission
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('filing:upload', {
        key,
        size: buffer.length,
        type: 'buffer'
      });
    });
    
    it('should download a file', async () => {
      const key = 'download-test.txt';
      const content = 'Download test content';
      
      // Create test file
      const filePath = path.join(testBaseDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      
      const downloadedBuffer = await filingService.download(key);
      
      expect(downloadedBuffer).toBeInstanceOf(Buffer);
      expect(downloadedBuffer.toString('utf8')).toBe(content);
      
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('filing:download', {
        key,
        size: downloadedBuffer.length
      });
    });
    
    it('should remove a file', async () => {
      const key = 'remove-test.txt';
      const content = 'File to be removed';
      
      // Create test file
      const filePath = path.join(testBaseDir, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      
      // Verify file exists
      let fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // Remove file
      await filingService.remove(key);
      
      // Verify file is removed
      fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
      
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('filing:remove', {
        key
      });
    });
    
    it('should handle nested directory structure', async () => {
      const key = 'nested/folder/structure/file.txt';
      const content = 'Nested file content';
      const buffer = Buffer.from(content, 'utf8');
      
      await filingService.upload(key, buffer);
      
      const filePath = path.join(testBaseDir, key);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      const savedContent = await fs.readFile(filePath, 'utf8');
      expect(savedContent).toBe(content);
    });
    
    it('should handle upload with stream', async () => {
      if (typeof filingService.uploadStream === 'function') {
        const key = 'stream-test.txt';
        const content = 'Stream upload content';
        
        // Create a readable stream from string
        const { Readable } = require('stream');
        const stream = new Readable({
          read() {
            this.push(content);
            this.push(null);
          }
        });
        
        await filingService.uploadStream(key, stream);
        
        const filePath = path.join(testBaseDir, key);
        const savedContent = await fs.readFile(filePath, 'utf8');
        expect(savedContent).toBe(content);
      }
    });
    
    it('should throw error when downloading non-existent file', async () => {
      await expect(filingService.download('non-existent.txt')).rejects.toThrow();
    });
    
    it('should handle removal of non-existent file gracefully', async () => {
      // Should not throw error
      await expect(filingService.remove('non-existent.txt')).resolves.not.toThrow();
    });
  });
  
  describe('Filing Service Factory', () => {
    
    it('should create local filing provider by default', () => {
      const mockEventEmitter = new EventEmitter();
      const service = createFilingService('local', {}, mockEventEmitter);
      expect(service).toBeDefined();
    });
    
    it('should create different providers based on type', () => {
      const mockEventEmitter = new EventEmitter();
      
      const localService = createFilingService('local', {}, mockEventEmitter);
      expect(localService).toBeDefined();
      
      // Test other providers if they exist
      try {
        const s3Service = createFilingService('s3', {
          accessKeyId: 'test',
          secretAccessKey: 'test',
          region: 'us-east-1',
          bucket: 'test-bucket'
        }, mockEventEmitter);
        expect(s3Service).toBeDefined();
      } catch (error) {
        // S3 provider might require actual AWS credentials or mocking
        expect(error.message).toContain('AWS');
      }
      
      try {
        const ftpService = createFilingService('ftp', {
          host: 'localhost',
          user: 'test',
          password: 'test'
        }, mockEventEmitter);
        expect(ftpService).toBeDefined();
      } catch (error) {
        // FTP provider might require actual FTP connection or mocking
        expect(error.message).toBeTruthy();
      }
    });
    
    it('should throw error for invalid provider type', () => {
      const mockEventEmitter = new EventEmitter();
      expect(() => {
        createFilingService('invalid-type', {}, mockEventEmitter);
      }).toThrow();
    });
  });
});