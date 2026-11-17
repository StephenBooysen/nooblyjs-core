// Declarations for esm/store.mjs (the files-only store, src/store/fs-store.js).

/** Path segments are validated: letters, digits, `.`, `_` and `-`, up to 128 characters. */
export declare const SEGMENT: RegExp;

export declare class StoreError extends Error {}

export interface StoreDocument<T = Record<string, unknown>> {
  data: T;
  body: string;
}

export interface FsStoreOptions {
  /** Anything with get/put/delete. Its failures only cost a disk read. */
  cache?: { get(key: string): unknown; put(key: string, value: unknown): unknown; delete(key: string): unknown } | null;
  maxCached?: number;
  cacheable?: (segments: string[]) => boolean;
}

export declare class FsStore {
  constructor(root: string, options?: FsStoreOptions);
  readonly root: string;
  /** Resolves path segments under the root. Throws StoreError when a segment is unsafe. */
  resolve(segments: string[]): string;
  withLock<T>(segments: string[], fn: () => Promise<T> | T): Promise<T>;
  exists(segments: string[]): Promise<boolean>;
  readText(segments: string[]): Promise<string | null>;
  writeText(segments: string[], text: string): Promise<void>;
  writeBuffer(segments: string[], buffer: Uint8Array): Promise<void>;
  readDoc<T = Record<string, unknown>>(segments: string[]): Promise<StoreDocument<T> | null>;
  writeDoc(segments: string[], data: Record<string, unknown>, body?: string): Promise<void>;
  /** Read-modify-write under the path lock. `fn` returns the new doc, or null to skip the write. */
  updateDoc<T = Record<string, unknown>>(
    segments: string[],
    fn: (doc: StoreDocument<T> | null) => StoreDocument<T> | null | Promise<StoreDocument<T> | null>
  ): Promise<StoreDocument<T> | null>;
  readYaml<T = unknown>(segments: string[]): Promise<T | null>;
  writeYaml(segments: string[], value: unknown): Promise<void>;
  appendYaml(segments: string[], record: unknown): Promise<void>;
  readYamlStream<T = unknown>(segments: string[]): Promise<T[]>;
  list(segments: string[], options?: { dirs?: boolean }): Promise<string[]>;
  remove(segments: string[]): Promise<void>;
  move(from: string[], to: string[]): Promise<void>;
  invalidate(full: string, options?: { tree?: boolean }): Promise<void>;
  cacheInfo(): { hits: number; misses: number; cached: number };
}

/** Parses a Markdown file with YAML front matter. A file without front matter has an empty `data`. */
export declare function parseMarkdown<T = Record<string, unknown>>(text: string): StoreDocument<T>;
/** Builds a Markdown file from front matter and a body. */
export declare function serializeMarkdown(data: Record<string, unknown>, body?: string): string;

declare const target: {
  FsStore: typeof FsStore;
  StoreError: typeof StoreError;
  parseMarkdown: typeof parseMarkdown;
  serializeMarkdown: typeof serializeMarkdown;
  SEGMENT: typeof SEGMENT;
};
export default target;
