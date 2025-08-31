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

jest.mock('aws-sdk', () => ({
  S3: jest.fn(() => mockS3),
  config: mockConfig,
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
const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');

describe('FilingService', () => {
  // Test LocalFilingProvider
  describe('LocalFilingProvider', () => {
    const testDir = path.join(__dirname, 'test_files');
    const testFilePath = path.join(testDir, 'test.txt');

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    });

    let localFilingService;

    beforeEach(() => {
      localFilingService = createFilingService('local', {});
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
      const files = await localFilingService.list(testDir);
      expect(files).toEqual(expect.arrayContaining(['file1.txt', 'file2.txt']));
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
      const filePath = '/remote/test.txt';
      const content = 'Hello FTP!';
      await ftpFilingService.create(filePath, content);
      expect(mockFtpClient.put).toHaveBeenCalledWith(
        Buffer.from(content),
        filePath,
        expect.any(Function),
      );
    });

    it('should read a file from FTP server', async () => {
      const filePath = '/remote/test.txt';
      const content = await ftpFilingService.read(filePath, 'utf8');
      expect(mockFtpClient.get).toHaveBeenCalledWith(
        filePath,
        expect.any(Function),
      );
      expect(content).toBe('mock file content');
    });

    it('should delete a file from FTP server', async () => {
      const filePath = '/remote/test.txt';
      await ftpFilingService.delete(filePath);
      expect(mockFtpClient.delete).toHaveBeenCalledWith(
        filePath,
        expect.any(Function),
      );
    });

    it('should list files on FTP server', async () => {
      const dirPath = '/remote/';
      const files = await ftpFilingService.list(dirPath);
      expect(mockFtpClient.list).toHaveBeenCalledWith(
        dirPath,
        expect.any(Function),
      );
      expect(files).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should update a file on FTP server', async () => {
      const filePath = '/remote/test.txt';
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
      s3FilingService = require('../../../src/filing')('s3', {
        bucketName: mockBucketName,
        region: mockRegion,
        accessKeyId: mockAccessKeyId,
        secretAccessKey: mockSecretAccessKey,
      });
      mockS3Instance = mockS3;
    });

    it('should initialize with correct S3 configuration', () => {
      expect(mockConfig.update).toHaveBeenCalledWith({
        region: mockRegion,
        accessKeyId: mockAccessKeyId,
        secretAccessKey: mockSecretAccessKey,
      });
      expect(require('aws-sdk').S3).toHaveBeenCalledTimes(1);
      expect(s3FilingService.provider.bucketName).toBe(mockBucketName);
    });

    it('should upload a file to S3', async () => {
      mockS3.upload().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      const content = 'Hello S3!';
      await s3FilingService.create(filePath, content);
      expect(mockS3.upload).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
        Body: content,
      });
      expect(mockS3.upload().promise).toHaveBeenCalledTimes(1);
    });

    it('should download a file from S3', async () => {
      const filePath = 'path/to/file.txt';
      const content = 'Hello S3!';
      mockS3
        .getObject()
        .promise.mockResolvedValueOnce({ Body: Buffer.from(content) });
      const result = await s3FilingService.read(filePath, 'utf8');
      expect(mockS3.getObject).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
      });
      expect(result).toBe(content);
    });

    it('should delete a file from S3', async () => {
      mockS3.deleteObject().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      await s3FilingService.delete(filePath);
      expect(mockS3.deleteObject).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
      });
      expect(mockS3.deleteObject().promise).toHaveBeenCalledTimes(1);
    });

    it('should list objects in a specified prefix', async () => {
      const dirPath = 'path/to/dir/';
      const s3Contents = [
        { Key: 'path/to/dir/file1.txt' },
        { Key: 'path/to/dir/file2.txt' },
      ];
      mockS3
        .listObjectsV2()
        .promise.mockResolvedValueOnce({ Contents: s3Contents });
      const result = await s3FilingService.list(dirPath);
      expect(mockS3.listObjectsV2).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Prefix: dirPath,
      });
      expect(result).toEqual([
        'path/to/dir/file1.txt',
        'path/to/dir/file2.txt',
      ]);
    });

    it('should update a file in S3 (calls create)', async () => {
      mockS3.upload().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      const content = 'Updated S3 content!';
      await s3FilingService.update(filePath, content);
      expect(mockS3.upload).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
        Body: content,
      });
      expect(mockS3Instance.upload().promise).toHaveBeenCalledTimes(1);
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
