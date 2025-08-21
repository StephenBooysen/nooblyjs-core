/**
 * @fileoverview Unit tests for the AWS S3 filing provider.
 */

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

const S3FilingProvider = require('../../../src/filing/providers/filingS3');

describe('S3FilingProvider', () => {
  const mockBucketName = 'test-bucket';
  const mockRegion = 'us-east-1';
  const mockAccessKeyId = 'test-access-key';
  const mockSecretAccessKey = 'test-secret-key';

  let s3FilingProvider;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    s3FilingProvider = new S3FilingProvider({
      bucketName: mockBucketName,
      region: mockRegion,
      accessKeyId: mockAccessKeyId,
      secretAccessKey: mockSecretAccessKey,
    });
  });

  it('should initialize with correct S3 configuration', () => {
    expect(mockConfig.update).toHaveBeenCalledWith({
      region: mockRegion,
      accessKeyId: mockAccessKeyId,
      secretAccessKey: mockSecretAccessKey,
    });
    expect(require('aws-sdk').S3).toHaveBeenCalledTimes(1);
    expect(s3FilingProvider.bucketName).toBe(mockBucketName);
  });

  it('should throw an error if bucketName or region are missing', () => {
    expect(() => new S3FilingProvider({ region: mockRegion })).toThrow(
      'S3FilingProvider requires bucketName and region in options.',
    );
    expect(() => new S3FilingProvider({ bucketName: mockBucketName })).toThrow(
      'S3FilingProvider requires bucketName and region in options.',
    );
    expect(() => new S3FilingProvider({})).toThrow(
      'S3FilingProvider requires bucketName and region in options.',
    );
  });

  describe('create', () => {
    it('should upload a file to S3', async () => {
      mockS3.upload().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      const content = 'Hello S3!';
      await s3FilingProvider.create(filePath, content);
      expect(mockS3.upload).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
        Body: content,
      });
      expect(mockS3.upload().promise).toHaveBeenCalledTimes(1);
    });
  });

  describe('read', () => {
    it('should download a file from S3', async () => {
      const filePath = 'path/to/file.txt';
      const content = 'Hello S3!';
      mockS3
        .getObject()
        .promise.mockResolvedValueOnce({ Body: Buffer.from(content) });
      const result = await s3FilingProvider.read(filePath);
      expect(mockS3.getObject).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
      });
      expect(result).toBe(content);
    });
  });

  describe('delete', () => {
    it('should delete a file from S3', async () => {
      mockS3.deleteObject().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      await s3FilingProvider.delete(filePath);
      expect(mockS3.deleteObject).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
      });
      expect(mockS3.deleteObject().promise).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('should list objects in a specified prefix', async () => {
      const dirPath = 'path/to/dir/';
      const s3Contents = [
        { Key: 'path/to/dir/file1.txt' },
        { Key: 'path/to/dir/file2.txt' },
      ];
      mockS3
        .listObjectsV2()
        .promise.mockResolvedValueOnce({ Contents: s3Contents });
      const result = await s3FilingProvider.list(dirPath);
      expect(mockS3.listObjectsV2).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Prefix: dirPath,
      });
      expect(result).toEqual([
        'path/to/dir/file1.txt',
        'path/to/dir/file2.txt',
      ]);
    });

    it('should return an empty array if no objects are found', async () => {
      const dirPath = 'empty/dir/';
      mockS3
        .listObjectsV2()
        .promise.mockResolvedValueOnce({ Contents: [] });
      const result = await s3FilingProvider.list(dirPath);
      expect(result).toEqual([]);
    });

    it('should return an empty array if Contents is undefined', async () => {
      const dirPath = 'empty/dir/';
      mockS3.listObjectsV2().promise.mockResolvedValueOnce({});
      const result = await s3FilingProvider.list(dirPath);
      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update a file in S3 (calls create)', async () => {
      mockS3.upload().promise.mockResolvedValueOnce({});
      const filePath = 'path/to/file.txt';
      const content = 'Updated S3 content!';
      await s3FilingProvider.update(filePath, content);
      expect(mockS3.upload).toHaveBeenCalledWith({
        Bucket: mockBucketName,
        Key: filePath,
        Body: content,
      });
      expect(mockS3.upload().promise).toHaveBeenCalledTimes(1);
    });
  });
});