// Declarations for esm/testing.mjs (the test kit, src/testing).

export declare const TEST_API_KEY: string;

/** Records every event emitted on a shared emitter, in order. */
export declare class EventRecorder {
  constructor(emitter: { on(event: string, fn: (...args: unknown[]) => void): unknown });
  /** Names of the events seen so far, in order. */
  names(): string[];
  /** Payloads of one event name, in order. */
  payloadsOf(event: string): unknown[];
}

export interface TestRegistry {
  registry: unknown;
  app: unknown;
  events: EventRecorder;
  /** Resets the registry and removes the temp directory. Call from afterEach. */
  cleanup(): Promise<void>;
}

/**
 * An Express app, an event recorder and a registry with the named services,
 * using in-memory providers under .temp/tests/data/.
 */
export declare function createTestRegistry(options?: {
  services?: Array<'logging' | 'caching' | 'queueing' | 'dataservice' | 'scheduling' | 'searching' | 'measuring' | 'working' | 'workflow' | 'notifying' | 'fetching'>;
  name?: string;
  registry?: unknown;
}): Promise<TestRegistry>;

/** Registers the custom Jest matchers (toHaveEmitted). Call once in a setup file. */
export declare function installMatchers(): void;

declare const target: {
  createTestRegistry: typeof createTestRegistry;
  installMatchers: typeof installMatchers;
  EventRecorder: typeof EventRecorder;
  TEST_API_KEY: typeof TEST_API_KEY;
};
export default target;
