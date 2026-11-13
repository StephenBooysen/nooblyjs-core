// Type declarations for nooblyjs-core (feature 08).
// The registry is a singleton: `import registry from 'nooblyjs-core'` (with esModuleInterop).
//
// Overloads name each provider, so a misspelt provider is a compile error and
// options autocomplete for the provider chosen. Options are also checked at run
// time against the schemas in src/shared/config/optionSchemas.js.

export interface CommonOptions {
  /** Instance name; separate instances of the same provider are cached apart. */
  instanceName?: string;
  /** Directory for file-backed data. */
  dataDir?: string;
  /** Directory for log files. */
  logDir?: string;
  [option: string]: unknown;
}

export interface ServiceOptions extends CommonOptions {}

// ---- Service interfaces -----------------------------------------------------

export interface CacheService {
  put(key: string, value: unknown): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<unknown>;
  getAnalytics(): unknown;
}

export interface QueueService {
  enqueue(queueName: string, item: unknown): Promise<unknown>;
  dequeue<T = unknown>(queueName: string): Promise<T | undefined>;
  size(queueName: string): Promise<number>;
  listQueues(): Promise<string[]>;
  purge(queueName: string): Promise<unknown>;
}

export type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

export interface DataContainer {
  add(item: unknown): Promise<unknown>;
  find(query: Record<string, unknown>): Promise<unknown[]>;
  getByUuid(uuid: string): Promise<unknown>;
  listAll(): Promise<unknown[]>;
  update(uuid: string, changes: Record<string, unknown>): Promise<unknown>;
  remove(uuid: string): Promise<unknown>;
  count(): Promise<number>;
}

export interface DataService {
  createContainer(containerName: string): Promise<DataContainer>;
}

export interface FilingService {
  create(filePath: string, content: string | Uint8Array): Promise<unknown>;
  read(filePath: string, encoding?: string): Promise<unknown>;
  update(filePath: string, content: string | Uint8Array): Promise<unknown>;
  delete(filePath: string): Promise<unknown>;
  list(dirPath: string): Promise<unknown>;
}

// ---- Provider options -------------------------------------------------------

export interface RedisCacheOptions extends ServiceOptions {
  redisUrl?: string;
  poolSize?: number;
}

export interface MemcachedCacheOptions extends ServiceOptions {
  memcachedurl?: string;
}

export interface RedisQueueOptions extends ServiceOptions {
  redisUrl?: string;
  redisPort?: number;
  host?: string;
  port?: number;
  poolSize?: number;
}

export interface MongoDataOptions extends ServiceOptions {
  connectionString?: string;
  database?: string;
}

export interface LocalFilingOptions extends ServiceOptions {
  baseDir?: string;
  maxFileSize?: number;
  allowedTypes?: string;
}

export interface S3FilingOptions extends ServiceOptions {
  bucketName: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  maxUploadSize?: number;
}

export interface FileLoggerOptions extends ServiceOptions {
  filename?: string;
  minLogLevel?: 'debug' | 'info' | 'warn' | 'error';
  maxSize?: number;
  maxFiles?: number;
  rotatePeriod?: string;
}

export interface ApiLoggerOptions extends ServiceOptions {
  apiRoot: string;
  apiKey?: string;
  minLogLevel?: 'debug' | 'info' | 'warn' | 'error';
  timeout?: number;
}

// ---- Registry ---------------------------------------------------------------

export interface InitializeOptions extends CommonOptions {
  /** Turn option warnings into errors. Recommended in CI. */
  strictOptions?: boolean;
  security?: Record<string, unknown>;
}

export interface ServiceRegistry {
  initialize(expressApp: unknown, eventEmitter?: unknown, globalOptions?: InitializeOptions): ServiceRegistry;

  cache(providerType: 'memory' | 'file' | 'aws' | 'azure' | 'gcp' | 'api', options?: ServiceOptions): CacheService;
  cache(providerType: 'redis', options?: RedisCacheOptions): CacheService;
  cache(providerType: 'memcached', options?: MemcachedCacheOptions): CacheService;

  queue(providerType: 'memory' | 'aws' | 'azure' | 'gcp' | 'activemq' | 'rabbitmq' | 'api', options?: ServiceOptions): QueueService;
  queue(providerType: 'redis', options?: RedisQueueOptions): QueueService;

  logger(providerType: 'memory', options?: ServiceOptions): Logger;
  logger(providerType: 'file', options?: FileLoggerOptions): Logger;
  logger(providerType: 'api', options?: ApiLoggerOptions): Logger;

  dataService(providerType: 'memory' | 'file' | 'api' | 'documentdb' | 'simpledb', options?: ServiceOptions): DataService;
  dataService(providerType: 'mongodb', options?: MongoDataOptions): DataService;

  filing(providerType: 'local', options?: LocalFilingOptions): FilingService;
  filing(providerType: 's3', options: S3FilingOptions): FilingService;
  filing(providerType: 'ftp' | 'gcp' | 'git' | 'api' | 'sync', options?: ServiceOptions): FilingService;

  getService(serviceName: string, providerType?: string, options?: ServiceOptions): unknown;
  shutdown(): void;
  reset(): void;
}

declare const registry: ServiceRegistry;
export default registry;
