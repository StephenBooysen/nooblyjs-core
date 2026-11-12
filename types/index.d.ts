// Type definitions for nooblyjs-core (feature 08).
//
//   import registry from 'nooblyjs-core';          // esModuleInterop
//   import registry = require('nooblyjs-core');
//   const cache: registry.CacheService = registry.cache('redis', { redisUrl: 'localhost' });
//
// The service types live in ./core.d.ts. `npm run check:types` compiles types/tests/ with strict mode.

import type * as T from './core';

declare const serviceRegistry: T.ServiceRegistry;

declare namespace serviceRegistry {
  export type ExpressAppLike = T.ExpressAppLike;
  export type RequestHandler = T.RequestHandler;
  export type JsonValue = T.JsonValue;
  export type ServiceSettings = T.ServiceSettings;
  export type BaseService = T.BaseService;
  export type CommonOptions = T.CommonOptions;
  export type LoggingService = T.LoggingService;
  export type LoggingOptions = T.LoggingOptions;
  export type LoggingFileOptions = T.LoggingFileOptions;
  export type ApiProviderOptions = T.ApiProviderOptions;
  export type CacheService = T.CacheService;
  export type CachingOptions = T.CachingOptions;
  export type CachingRedisOptions = T.CachingRedisOptions;
  export type CachingMemcachedOptions = T.CachingMemcachedOptions;
  export type CachingFileOptions = T.CachingFileOptions;
  export type DataService = T.DataService;
  export type DataFileOptions = T.DataFileOptions;
  export type DataMongoOptions = T.DataMongoOptions;
  export type JobState = T.JobState;
  export type Backoff = T.Backoff;
  export type JobOptions = T.JobOptions;
  export type Job = T.Job;
  export type Consumer = T.Consumer;
  export type JobCounts = T.JobCounts;
  export type QueueService = T.QueueService;
  export type QueueOptions = T.QueueOptions;
  export type QueueRedisOptions = T.QueueRedisOptions;
  export type FilingService = T.FilingService;
  export type FilingAccess = T.FilingAccess;
  export type FilingOptions = T.FilingOptions;
  export type FilingLocalOptions = T.FilingLocalOptions;
  export type FilingS3Options = T.FilingS3Options;
  export type SafeUser = T.SafeUser;
  export type Session = T.Session;
  export type ApiTokenInfo = T.ApiTokenInfo;
  export type AuthService = T.AuthService;
  export type AuthOptions = T.AuthOptions;
  export type AiMessage = T.AiMessage;
  export type AiTool = T.AiTool;
  export type AiRequest = T.AiRequest;
  export type AiUsage = T.AiUsage;
  export type AiReply = T.AiReply;
  export type AiStreamEvent = T.AiStreamEvent;
  export type AiPromptResult = T.AiPromptResult;
  export type AiServiceBase = T.AiServiceBase;
  export type AiService = T.AiService;
  export type AiV2Options = T.AiV2Options;
  export type AiLegacyOptions = T.AiLegacyOptions;
  export type WorkflowService = T.WorkflowService;
  export type SchedulingService = T.SchedulingService;
  export type SearchService = T.SearchService;
  export type WorkingService = T.WorkingService;
  export type MeasuringService = T.MeasuringService;
  export type NotifyingService = T.NotifyingService;
  export type FetchingService = T.FetchingService;
  export type SettingsService = T.SettingsService;
  export type GlobalOptions = T.GlobalOptions;
  export type ServiceRegistry = T.ServiceRegistry;
}

export = serviceRegistry;
