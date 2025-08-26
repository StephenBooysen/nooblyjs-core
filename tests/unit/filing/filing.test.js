/**
 * @fileoverview Unit tests for the FilingService and its providers.
 */

const createFilingService = require('../../src/filing');

const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');

// Mock the ftp client for FtpFilingProvider tests
jest.mock('ftp', () => {
  return jest.fn().mockImplementation(() => {
    const listeners = {};
    const mockClient = {
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
    return mockClient;
  });
});

// Mock the AWS S3 client
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
      localFilingService = createFilingService('local');
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
      const readContent = await localFilingService.read(testFilePath);
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
    let mockFtpClient;

    beforeEach(() => {
      // Clear mock and re-initialize for each test
      require('ftp').mockClear();
      ftpFilingService = createFilingService('ftp', {
        connectionString: 'ftp://localhost',
      });
      mockFtpClient = require('ftp').mock.instances[0];
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
      const content = await ftpFilingService.read(filePath);
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
      s3FilingService = require('../../src/filing')('s3', {
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
      const result = await s3FilingService.read(filePath);
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
});
