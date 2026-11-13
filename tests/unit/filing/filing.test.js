/**
 * @fileoverview Unit tests for the FilingService and its providers.
 */

// Mock the ftp client FIRST before any imports  
let listeners = {};
const mockFtpClient = {
  on: jest.fn((event, cb) => {
    listeners[event] = cb;
  }),
  once: jest.fn((event, cb) => {
    listeners[event] = cb;
  }),
  connect: jest.fn((options) => {
    setImmediate(() => {
      if (listeners.ready) listeners.ready();
    });
  }),
  end: jest.fn(() => {
    setImmediate(() => {
      if (listeners.end) listeners.end();
    });
  }),
  put: jest.fn((buffer, filePath, callback) => callback(null)),
  get: jest.fn((filePath, callback) => {
    const mockStream = new (require('stream').Readable)();
    mockStream.push('mock file content');
    mockStream.push(null);
    callback(null, mockStream);
  }),
  delete: jest.fn((filePath, callback) => callback(null)),
  list: jest.fn((dirPath, callback) =>
    callback(null, [{ name: 'file1.txt' }, { name: 'file2.txt' }]),
  ),
};

jest.mock('ftp', () => {
  return jest.fn().mockImplementation(() => mockFtpClient);
});

// Mock the AWS S3 client BEFORE imports
const mockS3 = {
  upload: jest.fn().mockReturnValue({
    promise: jest.fn(),
  }),
  getObject: jest.fn().mockReturnValue({
    promise: jest.fn(),
  }),
  deleteObject: jest.fn().mockReturnValue({
    promise: jest.fn(),
  }),
  listObjectsV2: jest.fn().mockReturnValue({
    promise: jest.fn(),
  }),
};

const mockConfig = {
  update: jest.fn(),
};

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockS3Send
  })),
  PutObjectCommand: jest.fn((params) => ({ commandType: 'put', params })),
  GetObjectCommand: jest.fn((params) => ({ commandType: 'get', params })),
  DeleteObjectCommand: jest.fn((params) => ({ commandType: 'delete', params })),
  ListObjectsV2Command: jest.fn((params) => ({ commandType: 'list', params }))
}));

// Mock the Google Cloud Storage client BEFORE imports
const mockGCSBucket = {
  file: jest.fn().mockReturnValue({
    save: jest.fn().mockResolvedValue(),
    download: jest.fn().mockResolvedValue([Buffer.from('mock gcp content')]),
    delete: jest.fn().mockResolvedValue(),
    exists: jest.fn().mockResolvedValue([true]),
    getMetadata: jest.fn().mockResolvedValue([{ 
      name: 'test-file.txt', 
      bucket: 'test-bucket',
      size: '100',
      contentType: 'text/plain',
      timeCreated: '2023-01-01T00:00:00.000Z',
      updated: '2023-01-01T00:00:00.000Z',
      etag: 'abc123',
      generation: '1234567890'
    }]),
    copy: jest.fn().mockResolvedValue(),
    move: jest.fn().mockResolvedValue(),
    getSignedUrl: jest.fn().mockResolvedValue(['https://signed-url.example.com']),
  }),
  exists: jest.fn().mockResolvedValue([true]),
  create: jest.fn().mockResolvedValue(),
  getFiles: jest.fn().mockResolvedValue([[
    { name: 'file1.txt' },
    { name: 'file2.txt' }
  ]]),
  getMetadata: jest.fn().mockResolvedValue([{ 
    name: 'test-bucket', 
    location: 'US',
    storageClass: 'STANDARD',
    timeCreated: '2023-01-01T00:00:00.000Z',
    updated: '2023-01-01T00:00:00.000Z'
  }]),
};

const mockGCS = {
  bucket: jest.fn().mockReturnValue(mockGCSBucket),
};

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => mockGCS),
}));

// Now import other modules
const createFilingService = require('../../../src/filing');
const { S3Client } = require('@aws-sdk/client-s3');
const fs = require('node:fs').promises;
const path = require('node:path');
const { testDataDir } = require('../../helpers/testData');

describe('FilingService', () => {
  // Test LocalFilingProvider
  describe('LocalFilingProvider', () => {
    const testDir = path.join(testDataDir('filing-local'));
    const testFilePath = path.join(testDir, 'test.txt');

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    });

    let localFilingService;

    beforeEach(() => {
      localFilingService = createFilingService('local', { baseDir: testDir });
    });

    afterEach(async () => {
      // Clean up test files after each test
      try {
        await fs.unlink(testFilePath);
      } catch (e) {
        // Ignore if file doesn't exist
      }
    });

    it('should create a file locally', async () => {
      const content = 'Hello Local!';
      await localFilingService.create(testFilePath, content);
      const readContent = await fs.readFile(testFilePath, 'utf8');
      expect(readContent).toBe(content);
    });

    it('should read a file locally', async () => {
      const content = 'Read this content.';
      await fs.writeFile(testFilePath, content);
      const readContent = await localFilingService.read(testFilePath, 'utf8');
      expect(readContent).toBe(content);
    });

    it('should delete a file locally', async () => {
      await fs.writeFile(testFilePath, 'Delete me!');
      await localFilingService.delete(testFilePath);
      await expect(fs.access(testFilePath)).rejects.toThrow();
    });

    it('should list files in a directory locally', async () => {
      await fs.writeFile(path.join(testDir, 'file1.txt'), '');
      await fs.writeFile(path.join(testDir, 'file2.txt'), '');
      const items = await localFilingService.list(testDir);

      // Items should be objects with type information
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(2);

      // Check that files are properly identified
      const file1 = items.find(item => item.name === 'file1.txt');
      const file2 = items.find(item => item.name === 'file2.txt');

      expect(file1).toBeDefined();
      expect(file2).toBeDefined();
      expect(file1.type).toBe('file');
      expect(file2.type).toBe('file');
      expect(file1.isFile).toBe(true);
      expect(file2.isFile).toBe(true);
    });

    it('should distinguish between files and folders when listing', async () => {
      const subDir = path.join(testDir, 'subfolder');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(testDir, 'testfile.txt'), 'content');

      const items = await localFilingService.list(testDir);

      // Items should be objects with type information
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(2);

      // Find the file and folder in results
      const testFile = items.find(item => item.name === 'testfile.txt');
      const subFolder = items.find(item => item.name === 'subfolder');

      // Both should be found
      expect(testFile).toBeDefined();
      expect(subFolder).toBeDefined();

      // File should be identified correctly
      expect(testFile.type).toBe('file');
      expect(testFile.isFile).toBe(true);
      expect(testFile.isDirectory).toBe(false);

      // Folder should be identified correctly
      expect(subFolder.type).toBe('folder');
      expect(subFolder.isDirectory).toBe(true);
      expect(subFolder.isFile).toBe(false);
    });

    it('should update a file locally', async () => {
      await fs.writeFile(testFilePath, 'Original content');
      const newContent = 'Updated content';
      await localFilingService.update(testFilePath, newContent);
      const readContent = await fs.readFile(testFilePath, 'utf8');
      expect(readContent).toBe(newContent);
    });
  });

  // Test FtpFilingProvider
  describe('FtpFilingProvider', () => {
    let ftpFilingService;

    beforeEach(() => {
      // Clear mock and re-initialize for each test
      jest.clearAllMocks();
      listeners = {};
      ftpFilingService = createFilingService('ftp', {
        connectionString: 'ftp://localhost',
      });
    });

    it('should connect to FTP server', async () => {
      await ftpFilingService.provider.connect();
      expect(mockFtpClient.connect).toHaveBeenCalledTimes(1);
      expect(ftpFilingService.provider.isConnected).toBe(true);
    });

    it('should create a file on FTP server', async () => {
      const filePath = 'remote/test.txt';
      const content = 'Hello FTP!';
      await ftpFilingService.create(filePath, content);
      expect(mockFtpClient.put).toHaveBeenCalledWith(
        Buffer.from(content),
        filePath,
        expect.any(Function),
      );
    });

    it('should read a file from FTP server', async () => {
      const filePath = 'remote/test.txt';
      const content = await ftpFilingService.read(filePath, 'utf8');
      expect(mockFtpClient.get).toHaveBeenCalledWith(
        filePath,
        expect.any(Function),
      );
      expect(content).toBe('mock file content');
    });

    it('should delete a file from FTP server', async () => {
      const filePath = 'remote/test.txt';
      await ftpFilingService.delete(filePath);
      expect(mockFtpClient.delete).toHaveBeenCalledWith(
        filePath,
        expect.any(Function),
      );
    });

    it('should list files on FTP server', async () => {
      const dirPath = 'remote/';
      const files = await ftpFilingService.list(dirPath);
      expect(mockFtpClient.list).toHaveBeenCalledWith(
        dirPath,
        expect.any(Function),
      );
      expect(files).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should update a file on FTP server', async () => {
      const filePath = 'remote/test.txt';
      const newContent = 'Updated FTP content';
      await ftpFilingService.update(filePath, newContent);
      expect(mockFtpClient.put).toHaveBeenCalledWith(
        Buffer.from(newContent),
        filePath,
        expect.any(Function),
      );
    });
  });

  // Test S3FilingProvider
  describe('S3FilingProvider', () => {
    const mockBucketName = 'test-bucket';
    const mockRegion = 'us-east-1';
    const mockAccessKeyId = 'test-access-key';
    const mockSecretAccessKey = 'test-secret-key';

    let s3FilingService;
    let mockS3Instance;

    beforeEach(() => {
      jest.clearAllMocks();

      // Setup S3 mock responses for different commands
      mockS3Send.mockImplementation((command) => {
        if (command.commandType === 'put') {
          return Promise.resolve({ Location: 'mock-location' });
        }
        if (command.commandType === 'get') {
          return Promise.resolve({
            Body: {
              transformToString: () => Promise.resolve('mock content'),
              transformToByteArray: () => Promise.resolve(Buffer.from('mock content'))
            }
          });
        }
        if (command.commandType === 'delete') {
          return Promise.resolve();
        }
        if (command.commandType === 'list') {
          return Promise.resolve({ Contents: [{ Key: 'mock-file.txt' }] });
        }
        return Promise.resolve();
      });

      s3FilingService = require('../../../src/filing')('s3', {
        bucketName: mockBucketName,
        region: mockRegion,
        accessKeyId: mockAccessKeyId,
        secretAccessKey: mockSecretAccessKey,
      });
    });

    it('should initialize with correct S3 configuration', () => {
      // AWS SDK v3 doesn't use AWS.config.update - credentials are passed to client constructor
      expect(require('@aws-sdk/client-s3').S3Client).toHaveBeenCalledTimes(1);
      expect(s3FilingService.provider.bucketName).toBe(mockBucketName);
    });

    it('should upload a file to S3', async () => {
      const filePath = 'path/to/file.txt';
      const content = 'Hello S3!';
      await s3FilingService.create(filePath, content);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('should download a file from S3', async () => {
      const filePath = 'path/to/file.txt';
      const result = await s3FilingService.read(filePath, 'utf8');
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(result).toBe('mock content');
    });

    it('should delete a file from S3', async () => {
      const filePath = 'path/to/file.txt';
      await s3FilingService.delete(filePath);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('should list objects in a specified prefix', async () => {
      const dirPath = 'path/to/dir/';
      const result = await s3FilingService.list(dirPath);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(result).toEqual(['mock-file.txt']);
    });

    it('should update a file in S3 (calls create)', async () => {
      const filePath = 'path/to/file.txt';
      const content = 'Updated S3 content!';
      await s3FilingService.update(filePath, content);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });
  });

  // Test GCPFilingProvider
  describe('GCPFilingProvider', () => {
    const mockBucketName = 'test-gcp-bucket';
    const mockKeyFilename = '.config/cloud-storage.json';

    let gcpFilingService;
    let mockGCSInstance;
    let mockBucketInstance;
    let mockFileInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      gcpFilingService = createFilingService('gcp', {
        bucketName: mockBucketName,
        keyFilename: mockKeyFilename,
      });
      mockGCSInstance = mockGCS;
      mockBucketInstance = mockGCSBucket;
      mockFileInstance = mockGCSBucket.file();
    });

    it('should initialize with correct GCS configuration', () => {
      expect(require('@google-cloud/storage').Storage).toHaveBeenCalledWith({
        keyFilename: mockKeyFilename,
      });
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(gcpFilingService.provider.bucketName_).toBe(mockBucketName);
    });

    it('should create a file in GCS bucket', async () => {
      const filePath = 'path/to/file.txt';
      const content = 'Hello GCS!';
      await gcpFilingService.create(filePath, content);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.save).toHaveBeenCalledWith(content);
    });

    it('should read a file from GCS bucket', async () => {
      const filePath = 'path/to/file.txt';
      const result = await gcpFilingService.read(filePath, 'utf8');
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.download).toHaveBeenCalledTimes(1);
      expect(result).toBe('mock gcp content');
    });

    it('should delete a file from GCS bucket', async () => {
      const filePath = 'path/to/file.txt';
      await gcpFilingService.delete(filePath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.delete).toHaveBeenCalledTimes(1);
    });

    it('should list files in GCS bucket', async () => {
      const dirPath = 'path/to/dir/';
      const result = await gcpFilingService.list(dirPath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.getFiles).toHaveBeenCalledWith({ 
        prefix: dirPath,
        delimiter: '/'
      });
      expect(result).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should update a file in GCS bucket', async () => {
      const filePath = 'path/to/file.txt';
      const newContent = 'Updated GCS content!';
      await gcpFilingService.update(filePath, newContent);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.save).toHaveBeenCalledWith(newContent);
    });

    it('should check if file exists', async () => {
      const filePath = 'path/to/file.txt';
      const result = await gcpFilingService.provider.exists(filePath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.exists).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('should get file metadata', async () => {
      const filePath = 'path/to/file.txt';
      const result = await gcpFilingService.provider.getMetadata(filePath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.getMetadata).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({
        name: 'test-file.txt',
        size: 100,
        bucket: expect.any(String),
        contentType: expect.any(String),
        created: expect.any(Date),
        updated: expect.any(Date),
        etag: expect.any(String),
        generation: expect.any(String)
      }));
    });

    it('should copy a file within GCS bucket', async () => {
      const sourcePath = 'path/to/source.txt';
      const destPath = 'path/to/dest.txt';
      await gcpFilingService.provider.copy(sourcePath, destPath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(sourcePath);
      expect(mockFileInstance.copy).toHaveBeenCalledWith(mockGCSBucket.file(destPath));
    });

    it('should move a file within GCS bucket', async () => {
      const sourcePath = 'path/to/source.txt';
      const destPath = 'path/to/dest.txt';
      await gcpFilingService.provider.move(sourcePath, destPath);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(sourcePath);
      // Move calls copy then delete, so we expect copy to be called
      expect(mockFileInstance.copy).toHaveBeenCalledWith(mockGCSBucket.file(destPath));
      expect(mockFileInstance.delete).toHaveBeenCalledTimes(1);
    });

    it('should generate signed URL for a file', async () => {
      const filePath = 'path/to/file.txt';
      const options = { action: 'read', expires: '03-09-2491' };
      const result = await gcpFilingService.provider.generateSignedUrl(filePath, options);
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.file).toHaveBeenCalledWith(filePath);
      expect(mockFileInstance.getSignedUrl).toHaveBeenCalledWith(options);
      expect(result).toBe('https://signed-url.example.com');
    });

    it('should get bucket info', async () => {
      const result = await gcpFilingService.provider.getBucketInfo();
      expect(mockGCS.bucket).toHaveBeenCalledWith(mockBucketName);
      expect(mockGCSBucket.getMetadata).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expect.objectContaining({
        name: 'test-bucket',
        location: 'US',
        storageClass: expect.any(String),
        created: expect.any(Date),
        updated: expect.any(Date)
      }));
    });

    it('should create bucket if it does not exist', async () => {
      // Mock bucket as not existing
      mockGCSBucket.exists.mockResolvedValueOnce([false]);
      
      const newGcpService = createFilingService('gcp', {
        bucketName: 'new-test-bucket',
        keyFilename: mockKeyFilename,
        location: 'EU',
        storageClass: 'COLDLINE'
      });

      // Wait for bucket creation to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockGCSBucket.exists).toHaveBeenCalled();
      expect(mockGCSBucket.create).toHaveBeenCalledWith({
        location: 'EU',
        storageClass: 'COLDLINE'
      });
    });

    it('should not create bucket if it already exists', async () => {
      // Mock bucket as existing (default behavior)
      mockGCSBucket.exists.mockResolvedValueOnce([true]);
      
      const newGcpService = createFilingService('gcp', {
        bucketName: 'existing-bucket',
        keyFilename: mockKeyFilename
      });

      // Wait for bucket check to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockGCSBucket.exists).toHaveBeenCalled();
      expect(mockGCSBucket.create).not.toHaveBeenCalled();
    });
  });
});
