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

export interface JobOptions {
  /** Wait this long before the first delivery. */
  delayMs?: number;
  /** Deliveries before the job moves to the dead-letter list (default 3). */
  attempts?: number;
  backoff?: { type?: 'fixed' | 'exponential'; delayMs?: number; maxDelayMs?: number };
  /** A second enqueue with the same key inside the window returns the first job's id. */
  idempotencyKey?: string;
  dedupeWindowMs?: number;
  priority?: 'high' | 'normal' | 'low';
}

export interface Job<T = unknown> {
  id: string;
  queueName: string;
  data: T;
  attempt: number;
  attempts: number;
  state: string;
  [field: string]: unknown;
}

export interface JobConsumer {
  stop(): Promise<void>;
  inFlight(): number;
}

export interface QueueService {
  enqueue(queueName: string, item: unknown): Promise<unknown>;
  /** Reliable job (memory and redis providers): returns the job id. */
  enqueue(queueName: string, item: unknown, options: JobOptions): Promise<string>;
  process<T = unknown>(
    queueName: string,
    handler: (job: Job<T>) => Promise<unknown>,
    options?: { concurrency?: number; visibilityTimeoutMs?: number; pollIntervalMs?: number }
  ): JobConsumer;
  getJob(id: string, queueName?: string): Promise<Job | null>;
  retryDeadLetters(queueName: string): Promise<unknown>;
  jobCounts(queueName: string): Promise<Record<string, number>>;
  stopConsumers(): Promise<void>;
  readonly supportsReliableJobs?: boolean;
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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

export interface AIRequest {
  messages: ChatMessage[];
  system?: string;
  /** Overrides the instance's model for this request. */
  model?: string;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  maxTokens?: number;
}

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AIReply {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string | null;
  usage: AIUsage;
  model?: string;
  /** US dollars, from the catalogue's prices (0 when unknown). */
  cost?: number;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  usage: { input_tokens: number };
}

/** The shared-module AI service (anthropic, bedrock, vertex, azure, openai-compatible, mock, or a legacy name with legacy: false). */
export interface AIService {
  prompt(prompt: string, options?: { maxTokens?: number; system?: string }): Promise<{ content: string; usage: unknown; model: string | null; provider: string }>;
  complete(request: AIRequest): Promise<AIReply>;
  stream(request: AIRequest): AsyncGenerator<{ type: string; [field: string]: unknown }>;
  streamToResponse(res: unknown, request: AIRequest): Promise<void>;
  generateObject<T = Record<string, unknown>>(request: AIRequest & { schema: Record<string, unknown> }): Promise<T>;
  embed(texts: string | string[], options?: { model?: string; dimensions?: number }): Promise<EmbedResult>;
  listModels(): Promise<Array<{ id: string; label: string; contextWindow: number | null; pricing: unknown }>>;
  getSettings(): Record<string, unknown>;
}

/** A legacy AI provider (claude, openai, ollama, gemini, openai-kv, tensorflow): prompt() only. */
export interface LegacyAIService {
  prompt(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<unknown>;
  getSettings?(): unknown;
}

export interface AuthService {
  createUser(user: { username?: string; email: string; password: string; role?: string; [field: string]: unknown }): Promise<unknown>;
  authenticateUser(email: string, password: string): Promise<unknown>;
  validateSession(token: string): Promise<unknown>;
  logout(token: string): Promise<unknown>;
  getUser(email: string): Promise<unknown>;
  updateUser(email: string, updates: Record<string, unknown>): Promise<unknown>;
  deleteUser(email: string): Promise<unknown>;
  listUsers(): Promise<unknown[]>;
  addUserToRole(email: string, role: string): Promise<unknown>;
  listRoles(): Promise<string[]>;
  changePassword(email: string, currentPassword: string, newPassword: string): Promise<unknown>;
  /** Personal access token; `permissions` narrows it to a subset of the owner's. */
  createApiToken(email: string, name: string, options?: { expiresInDays?: number; expiresAt?: string | Date; permissions?: string[] }): Promise<unknown>;
  validateApiToken(token: string): Promise<{ email: string; roles: string[]; permissions?: string[] | null; [field: string]: unknown }>;
}

export interface SettingsService {
  [method: string]: unknown;
}

// ---- Provider options -------------------------------------------------------

export interface AIBudgets {
  maxTokensPerRequest?: number;
  maxCostPerDay?: number;
}

export interface SharedAIOptions extends ServiceOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  budgets?: AIBudgets;
  /** Where embed() goes; needed for providers without embeddings (anthropic, azure). */
  embeddings?: { provider: string; model?: string; apiKey?: string; baseUrl?: string };
  /** Replies for the mock provider. */
  script?: Array<{ text?: string; [field: string]: unknown }>;
}

export interface LegacyAIOptions extends ServiceOptions {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  endpoint?: string;
  legacy?: true;
}

export interface AuthOptions extends ServiceOptions {
  sessionIdleTimeoutMs?: { admin?: number; user?: number };
  invitations?: { mode?: 'closed' | 'approval' | 'domain' | 'open'; allowedDomains?: string[]; deliverCode?: (invite: unknown) => unknown };
  loginSuccessRedirectUrl?: string;
  createDefaultAdmin?: boolean;
}

export interface OAuthOptions extends AuthOptions {
  clientID: string;
  clientSecret: string;
  callbackURL?: string;
}


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

  aiservice(providerType: 'anthropic' | 'openai-compatible' | 'bedrock' | 'vertex' | 'azure' | 'mock', options?: SharedAIOptions): AIService;
  aiservice(providerType: 'claude' | 'openai' | 'chatgpt' | 'ollama' | 'gemini', options: SharedAIOptions & { legacy: false }): AIService;
  aiservice(providerType: 'claude' | 'openai' | 'chatgpt' | 'ollama' | 'gemini' | 'openai-kv' | 'tensorflow', options?: LegacyAIOptions): LegacyAIService;

  authservice(providerType: 'memory' | 'file' | 'passport' | 'secure-email', options?: AuthOptions): AuthService;
  authservice(providerType: 'google', options: OAuthOptions): AuthService;
  authservice(providerType: 'azure', options: OAuthOptions & { tenantID: string }): AuthService;
  authservice(providerType: 'api', options?: ServiceOptions): AuthService;

  settings(providerType: 'file' | 'encrypted', options?: ServiceOptions & { filepath?: string; secret?: string; autosave?: boolean; maskSecrets?: boolean }): SettingsService;

  getService(serviceName: string, providerType?: string, options?: ServiceOptions): unknown;
  shutdown(): void;
  reset(): void;
}

declare const registry: ServiceRegistry;
export default registry;
