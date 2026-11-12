// Service and registry types for nooblyjs-core (feature 08); types/index.d.ts is the entry point.
// Hand-written against the providers in src/*/provider(s)/; `npm run check:types`
// compiles the examples in types/tests/ with `strict: true` so they cannot drift.

import type { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

/** Structural Express types, so consumers need no @types/express. */
export interface ExpressAppLike { use(...args: any[]): unknown; get(...args: any[]): unknown; post(...args: any[]): unknown }
export type RequestHandler = (req: any, res: any, next: (error?: unknown) => void) => unknown;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Every service exposes runtime settings for its dashboard. */
export interface ServiceSettings {
  description?: string;
  list: Array<{ setting: string; type: string; values?: unknown }>;
  [setting: string]: unknown;
}

export interface BaseService {
  getSettings(): Promise<ServiceSettings>;
  saveSettings(settings: Record<string, unknown>): Promise<void>;
}

/** Options every factory accepts. */
export interface CommonOptions {
  /** Separate instances of one provider (default 'default'). */
  instanceName?: string;
}

// ---------------------------------------------------------------- logging

export interface LoggingService extends BaseService {
  debug(message: string, meta?: Record<string, unknown>): Promise<void>;
  info(message: string, meta?: Record<string, unknown>): Promise<void>;
  warn(message: string, meta?: Record<string, unknown>): Promise<void>;
  error(message: string, meta?: Record<string, unknown>): Promise<void>;
  log(message: string, meta?: Record<string, unknown>): Promise<void>;
}

export interface LoggingOptions extends CommonOptions { level?: 'debug' | 'info' | 'warn' | 'error' }
export interface LoggingFileOptions extends LoggingOptions {
  logDir?: string; filename?: string; maxFiles?: number; maxSize?: number; rotatePeriod?: string;
}
export interface ApiProviderOptions extends CommonOptions {
  api?: string; apiRoot?: string; apiKey?: string; timeout?: number; retryLimit?: number;
}

// ---------------------------------------------------------------- caching

export interface CacheService extends BaseService {
  put<T = unknown>(key: string, value: T): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  getAnalytics?(): unknown;
}

export interface CachingOptions extends CommonOptions { maxSize?: number; ttl?: number }
export interface CachingRedisOptions extends CachingOptions {
  /** Redis host (canonical name; `redisurl` is the legacy spelling). */
  redisUrl?: string;
  /** @deprecated use redisUrl */
  redisurl?: string;
  poolSize?: number;
  [ioredisOption: string]: unknown;
}
export interface CachingMemcachedOptions extends CachingOptions { memcachedUrl?: string; /** @deprecated */ memcachedurl?: string }
export interface CachingFileOptions extends CachingOptions { cacheDir?: string }

// ---------------------------------------------------------------- data

export interface DataService extends BaseService {
  createContainer(containerName: string): Promise<void>;
  /** Returns the new record's uuid. */
  add(containerName: string, record: object): Promise<string>;
  getByUuid<T = Record<string, unknown>>(containerName: string, uuid: string): Promise<T | null>;
  update(containerName: string, uuid: string, record: object): Promise<unknown>;
  remove(containerName: string, uuid: string): Promise<boolean>;
  listAll<T = Record<string, unknown>>(containerName: string): Promise<T[]>;
  find<T = Record<string, unknown>>(containerName: string, searchTerm?: string): Promise<T[]>;
  count(containerName: string): Promise<number>;
  close?(): Promise<void>;
}

export interface DataFileOptions extends CommonOptions { baseDir?: string; storageLocation?: string; autoBackup?: boolean; maxFileSize?: number }
export interface DataMongoOptions extends CommonOptions {
  connectionString?: string; database?: string; maxConnections?: number; connectionTimeout?: number; queryTimeout?: number;
}

// ---------------------------------------------------------------- queueing

export type JobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed' | 'dead';
export interface Backoff { type: 'fixed' | 'exponential'; baseMs?: number; maxMs?: number }
export interface JobOptions {
  delayMs?: number;
  attempts?: number;
  backoff?: Backoff;
  idempotencyKey?: string;
  dedupeWindowMs?: number;
  priority?: 'high' | 'normal' | 'low';
  jobId?: string;
}
export interface Job<T = unknown> {
  id: string;
  queue: string;
  data: T;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  backoff: Backoff;
  priority: 'high' | 'normal' | 'low';
  idempotencyKey: string | null;
  createdAt: number;
  availableAt: number;
  startedAt?: number;
  finishedAt: number | null;
  lastError: string | null;
  result?: unknown;
}
export interface Consumer {
  queue: string;
  running(): number;
  /** Stops taking jobs, waits for running ones; jobs still running after timeoutMs go back to the queue. */
  stop(options?: { timeoutMs?: number }): Promise<void>;
}
export interface JobCounts {
  waiting: number; delayed: number; active: number; dead: number;
  processed: { completed: number; failed: number; dead: number; processed: number };
}

export interface QueueService extends BaseService {
  enqueue(queueName: string, item: unknown): Promise<void>;
  /** With options: a reliable job (feature 06); resolves to its id. */
  enqueue(queueName: string, item: unknown, options: JobOptions): Promise<string>;
  dequeue<T = unknown>(queueName: string): Promise<T | undefined>;
  size(queueName: string): Promise<number>;
  listQueues(): Promise<string[]>;
  purge(queueName: string): Promise<void>;
  /** Whether reliable jobs work on this provider (memory, redis, or jobs.store = 'memory'). */
  supportsJobs: boolean;
  process<T = unknown>(
    queueName: string,
    handler: (job: Job<T>) => unknown | Promise<unknown>,
    options?: { concurrency?: number; visibilityTimeoutMs?: number; pollMs?: number }
  ): Consumer;
  getJob<T = unknown>(id: string): Promise<Job<T> | null>;
  retryDeadLetters(queueName: string, options?: { ids?: string[] }): Promise<number>;
  listDeadLetters(queueName: string, limit?: number): Promise<Job[]>;
  removeJob(queueName: string, id: string): Promise<boolean>;
  jobCounts(queueName: string): Promise<JobCounts>;
  stopConsumers(options?: { timeoutMs?: number }): Promise<void>;
}

export interface QueueOptions extends CommonOptions {
  jobs?: {
    attempts?: number; backoff?: Backoff; dedupeWindowMs?: number; visibilityTimeoutMs?: number; pollMs?: number;
    store?: 'memory'; keepCompletedMs?: number;
  };
}
export interface QueueRedisOptions extends QueueOptions {
  redisUrl?: string; redisPort?: number;
  /** @deprecated use redisUrl */ redisurl?: string;
  /** @deprecated use redisPort */ redisport?: number;
  [ioredisOption: string]: unknown;
}

// ---------------------------------------------------------------- filing

export interface FilingService extends BaseService {
  create(filePath: string, content: string | Buffer | NodeJS.ReadableStream): Promise<void>;
  read(filePath: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  update(filePath: string, content: string | Buffer | NodeJS.ReadableStream): Promise<void>;
  delete(filePath: string): Promise<void>;
  list(dirPath: string): Promise<string[]>;
}
export interface FilingAccess { writeRoles?: string[]; adminRoles?: string[]; acl?: Record<string, unknown> }
export interface FilingOptions extends CommonOptions { access?: FilingAccess; maxFileSize?: number; allowedTypes?: string | string[] }
export interface FilingLocalOptions extends FilingOptions { baseDir?: string }
export interface FilingS3Options extends FilingOptions { bucketName?: string; region?: string; accessKeyId?: string; secretAccessKey?: string }

// ---------------------------------------------------------------- auth

export interface SafeUser { id: string; email: string; fullName?: string; role?: string; roles?: string[]; isActive?: boolean; [key: string]: unknown }
export interface Session { token: string; userId: string; email: string; fullName?: string; roles: string[]; createdAt: Date; expiresAt: Date }
export interface ApiTokenInfo { id: string; name: string; tokenPrefix: string; createdAt: Date; lastUsed: Date | null; expiresAt: Date | null; scopes: string[] | null }

export interface AuthService extends BaseService {
  createUser(user: { email: string; fullName?: string; password: string; role?: string; roles?: string[] }): Promise<SafeUser>;
  authenticateUser(email: string, password: string): Promise<{ user: SafeUser; session: { token: string; expiresAt: Date } }>;
  validateSession(token: string): Promise<Session>;
  logout(token: string): Promise<void>;
  getUser(email: string): Promise<SafeUser>;
  updateUser(email: string, updates: Record<string, unknown>): Promise<SafeUser>;
  deleteUser(email: string): Promise<void>;
  listUsers(): Promise<SafeUser[]>;
  addUserToRole(email: string, role: string): Promise<void>;
  listRoles(): Promise<string[]>;
  changePassword(email: string, currentPassword: string, newPassword: string): Promise<SafeUser>;
  createApiToken(email: string, name: string, options?: { expiresInDays?: number; expiresAt?: string | Date; scopes?: string[] }):
    Promise<ApiTokenInfo & { token: string }>;
  listApiTokens(email: string): Promise<ApiTokenInfo[]>;
  deleteApiToken(email: string, tokenId: string): Promise<void>;
  validateApiToken(token: string): Promise<{ email: string; roles: string[]; user: SafeUser; token: ApiTokenInfo }>;
  revokeUserSessions(email: string, reason: string): number;
  createAuthMiddleware(options?: { loginPath?: string; saveReferer?: boolean }): RequestHandler;
}
export interface AuthOptions extends CommonOptions {
  invitations?: { mode?: 'admin-approval' | 'admin-only' | 'domain-allowlist' | 'open'; [key: string]: unknown };
  session?: { idleTimeoutMs?: number; adminIdleTimeoutMs?: number; absoluteTimeoutMs?: number };
  tokens?: { defaultExpiryDays?: number; maxExpiryDays?: number; allowNonExpiring?: boolean };
  [key: string]: unknown;
}

// ---------------------------------------------------------------- AI

export type AiMessage = { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };
export interface AiTool { name: string; description?: string; input_schema: Record<string, unknown> }
export interface AiRequest {
  messages?: AiMessage[]; prompt?: string; system?: string; tools?: AiTool[];
  maxTokens?: number; temperature?: number; model?: string; signal?: AbortSignal;
}
export interface AiUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export interface AiReply {
  text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string | null; usage: AiUsage; cost: number; model: string; message: Record<string, unknown>;
}
export type AiStreamEvent =
  | { type: 'message_start'; model: string; usage: Partial<AiUsage> }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'retry'; attempt: number; delayMs: number; error: string }
  | { type: 'message'; message: Record<string, unknown> }
  | { type: 'usage'; usage: AiUsage; cost: number; model: string };

export interface AiPromptResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string; provider: string; cost?: number;
}

/** Every AI provider (legacy and v2). */
export interface AiServiceBase extends BaseService {
  prompt(prompt: string, options?: { maxTokens?: number; temperature?: number; system?: string; model?: string; username?: string }): Promise<AiPromptResult>;
  listModels?(): Promise<unknown[]>;
}
/** AI Service v2 (feature 02): anthropic, openai-compatible, bedrock, vertex, azure, mock, ... */
export interface AiService extends AiServiceBase {
  readonly providerName: string;
  complete(request: AiRequest): Promise<AiReply>;
  stream(request: AiRequest): AsyncGenerator<AiStreamEvent>;
  streamToResponse(res: ServerResponse, request: AiRequest): Promise<void>;
  generateObject<T = unknown>(request: AiRequest & { schema: Record<string, unknown>; retries?: number }):
    Promise<{ object: T; usage: AiUsage; cost: number; model: string }>;
  embed(input: string | string[], options?: { dimensions?: number; model?: string }): Promise<number[][]>;
}
export interface AiV2Options extends CommonOptions {
  model?: string; apiKey?: string; baseUrl?: string; maxTokens?: number; temperature?: number; system?: string;
  maxCostPerDay?: number; maxTokensPerRequest?: number;
  embeddingProvider?: 'openai' | 'openai-compatible' | 'gemini' | 'ollama' | 'bedrock' | 'vertex' | 'mock';
  embeddingModel?: string; embeddingApiKey?: string; embeddingBaseUrl?: string;
  script?: Array<{ text?: string; tools?: Array<{ name: string; input?: object }>; usage?: object } | Error>;
  providerOptions?: Record<string, unknown>;
}
export interface AiLegacyOptions extends AiV2Options { /** false: use AI Service v2 for this name */ legacy?: boolean; apikey?: string; maxtokens?: number }

// ---------------------------------------------------------------- other services

export interface WorkflowService extends BaseService {
  defineWorkflow(name: string, steps: string[], metadata?: Record<string, unknown>): Promise<void>;
  runWorkflow(name: string, data?: unknown, statusCallback?: (status: unknown) => void, options?: Record<string, unknown>): Promise<unknown>;
  listWorkflows(options?: Record<string, unknown>): unknown[];
  getWorkflow(name: string): unknown;
  deleteWorkflow(name: string): Promise<boolean>;
  exportState(): unknown;
  importState(snapshot: unknown): void;
}

export interface SchedulingService extends BaseService {
  start(taskName: string, scriptPath: string, dataOrInterval?: unknown, intervalSecondsOrCallback?: unknown,
    executionCallback?: (...args: unknown[]) => void, options?: Record<string, unknown>): Promise<void>;
  startCron(task: string | { scriptPath: string; data?: unknown }, cron: string, taskName: string,
    callback?: (...args: unknown[]) => void): Promise<void>;
  stop(taskName: string): Promise<boolean>;
  pause(taskName: string): Promise<boolean>;
  resume(taskName: string): Promise<boolean>;
  listSchedules(): unknown[];
  shutdown(): Promise<void>;
}

export interface SearchService extends BaseService {
  add(key: string, document: object, containerOrOptions?: string | Record<string, unknown>): Promise<boolean>;
  remove(key: string, containerOrOptions?: string | Record<string, unknown>): Promise<boolean>;
  search<T = unknown>(query: string, containerOrOptions?: string | Record<string, unknown>): Promise<T[]>;
  suggest?(prefix: string, options?: Record<string, unknown>): Promise<string[]>;
}

export interface WorkingService extends BaseService {
  start(scriptPath: string, data?: unknown, completionCallback?: (status: 'completed' | 'error', data: unknown) => void,
    options?: { attempts?: number; backoff?: Backoff }): Promise<string>;
  stop(): Promise<void>;
  getStatus(): Promise<Record<string, unknown>>;
}

export interface MeasuringService extends BaseService {
  add(metric: string, value: number, timestamp?: Date): Promise<void> | void;
  list(metric: string, from?: Date, to?: Date): unknown;
  total(metric: string, from?: Date, to?: Date): unknown;
  average(metric: string, from?: Date, to?: Date): unknown;
}

export interface NotifyingService extends BaseService {
  createTopic(topic: string): Promise<void>;
  subscribe(topic: string, callback: (message: unknown) => void): Promise<void>;
  unsubscribe(topic: string, callback: (message: unknown) => void): Promise<void>;
  notify(topic: string, message: unknown): Promise<void>;
}

export interface FetchingService extends BaseService {
  fetch(url: string, options?: Record<string, unknown>): Promise<unknown>;
}

export interface SettingsService extends BaseService {
  get<T = unknown>(group: string, key: string): Promise<T | undefined>;
  set(group: string, key: string, value: unknown, options?: Record<string, unknown>): Promise<void>;
  delete(group: string, key: string): Promise<boolean>;
  getAll(group?: string): Promise<Record<string, unknown>>;
  listGroups(): Promise<string[]>;
}

// ---------------------------------------------------------------- registry

export interface GlobalOptions {
  security?: {
    apiKeyAuth?: { apiKeys?: Array<string | { key: string; name?: string; scopes?: string[] }>; requireApiKey?: boolean; excludePaths?: string[] };
    servicesAuth?: { requireLogin?: boolean; apiKeys?: string[] };
    roles?: Record<string, string[]>;
    strictAuth?: boolean;
    csrf?: { enabled?: boolean; allowedOrigins?: string[] };
  };
  /** Turn option warnings (unknown or misspelt keys) into errors. Recommended in CI. */
  strictOptions?: boolean;
  apiKeys?: string[];
  requireApiKey?: boolean;
  logDir?: string;
  dataDir?: string;
  [key: string]: unknown;
}

export interface ServiceRegistry {
  initialize(app: ExpressAppLike, eventEmitter?: EventEmitter | null, options?: GlobalOptions): ServiceRegistry;

  logger(provider?: 'memory', options?: LoggingOptions): LoggingService;
  logger(provider: 'file', options?: LoggingFileOptions): LoggingService;
  logger(provider: 'api', options?: ApiProviderOptions): LoggingService;

  cache(provider?: 'memory', options?: CachingOptions): CacheService;
  cache(provider: 'redis', options?: CachingRedisOptions): CacheService;
  cache(provider: 'memcached', options?: CachingMemcachedOptions): CacheService;
  cache(provider: 'file', options?: CachingFileOptions): CacheService;
  cache(provider: 'aws' | 'azure' | 'gcp', options?: CachingOptions & Record<string, unknown>): CacheService;
  cache(provider: 'api', options?: ApiProviderOptions): CacheService;

  dataService(provider?: 'memory', options?: CommonOptions): DataService;
  dataService(provider: 'file', options?: DataFileOptions): DataService;
  dataService(provider: 'mongodb' | 'documentdb', options?: DataMongoOptions & Record<string, unknown>): DataService;
  dataService(provider: 'simpledb', options?: CommonOptions & Record<string, unknown>): DataService;
  dataService(provider: 'api', options?: ApiProviderOptions): DataService;

  queue(provider?: 'memory', options?: QueueOptions): QueueService;
  queue(provider: 'redis', options?: QueueRedisOptions): QueueService;
  queue(provider: 'rabbitmq' | 'activemq' | 'aws' | 'azure' | 'gcp', options?: QueueOptions & Record<string, unknown>): QueueService;
  queue(provider: 'api', options?: ApiProviderOptions & QueueOptions): QueueService;

  filing(provider?: 'local', options?: FilingLocalOptions): FilingService;
  filing(provider: 's3', options?: FilingS3Options): FilingService;
  filing(provider: 'ftp' | 'git' | 'gcp' | 'sync', options?: FilingOptions & Record<string, unknown>): FilingService;
  filing(provider: 'api', options?: ApiProviderOptions): FilingService;
  filer(provider?: 'local', options?: FilingLocalOptions): FilingService;

  authservice(provider?: 'file' | 'memory' | 'passport' | 'google' | 'azure' | 'secure-email', options?: AuthOptions): AuthService;
  authservice(provider: 'api', options?: ApiProviderOptions): AuthService;

  aiservice(provider: 'anthropic' | 'openai-compatible' | 'grok' | 'deepseek' | 'bedrock' | 'vertex' | 'azure' | 'mock', options?: AiV2Options): AiService;
  aiservice(provider: 'claude' | 'openai' | 'chatgpt' | 'ollama' | 'gemini', options: AiLegacyOptions & { legacy: false }): AiService;
  aiservice(provider?: 'claude' | 'openai' | 'chatgpt' | 'ollama' | 'gemini' | 'openai-kv' | 'tensorflow', options?: AiLegacyOptions & Record<string, unknown>): AiServiceBase;

  workflow(provider?: 'memory' | 'api', options?: CommonOptions & Record<string, unknown>): WorkflowService;
  scheduling(provider?: 'memory', options?: CommonOptions & Record<string, unknown>): SchedulingService;
  searching(provider?: 'memory' | 'default' | 'vector' | 'semantic' | 'api' | 'solr', options?: CommonOptions & Record<string, unknown>): SearchService;
  working(provider?: 'memory' | 'default' | 'api', options?: CommonOptions & Record<string, unknown>): WorkingService;
  measuring(provider?: 'memory' | 'default' | 'api', options?: CommonOptions & Record<string, unknown>): MeasuringService;
  notifying(provider?: 'memory' | 'default' | 'api', options?: CommonOptions & Record<string, unknown>): NotifyingService;
  fetching(provider?: 'node' | 'axios', options?: CommonOptions & Record<string, unknown>): FetchingService;
  settings(provider?: 'file' | 'encrypted', options?: CommonOptions & { secret?: string } & Record<string, unknown>): SettingsService;
  appservice(provider: string, options?: Record<string, unknown>): unknown;

  getService<T = unknown>(serviceName: string, providerType?: string, options?: Record<string, unknown>): T;
  getServiceInstance<T = unknown>(serviceName: string, providerType?: string, instanceName?: string): T | null;
  setDefaultProvider(serviceName: string, providerType: string, options?: Record<string, unknown>): void;
  listServices(): string[];
  listInstances(serviceName: string): Array<{ instanceName: string; providerType: string }>;
  getEventEmitter(): EventEmitter;
  generateApiKey(length?: number): string;
  validateDependencies(): boolean;
  /** Feature 19: routes with no declared permission; throws in strict mode. */
  verifyRoutePermissions(options?: { strict?: boolean }): string[];
  shutdown(options?: { perServiceTimeoutMs?: number }): Promise<void>;
  reset(): void;
  resetService(serviceName: string): number;
}

