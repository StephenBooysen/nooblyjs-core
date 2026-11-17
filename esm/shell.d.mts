// Declarations for esm/shell.mjs (the UI shell, src/shell/index.js).

/** Absolute path to public/ui, the UI kit served at /ui/. */
export declare const UI_DIR: string;
/** Absolute path to the frame page every hosted app is drawn into. */
export declare const FRAME_FILE: string;

export interface ShellOptions {
  /** The Express module (or any object with a Router-compatible `Router`). */
  express: unknown;
  /** Resolves the signed-in principal for a request. */
  auth: (req: unknown) => unknown;
  /** Tells whether a principal may do an action. */
  can: (principal: unknown, action: string) => boolean | Promise<boolean>;
  permissionsFor?: (principal: unknown) => Promise<string[]> | string[];
  features?: Record<string, boolean>;
  log?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } | Console;
}

/** Builds the shell router: the rail, sidebar, status cards and the frame page. */
export declare function createShell(options: ShellOptions): unknown;

declare const target: { createShell: typeof createShell; UI_DIR: typeof UI_DIR; FRAME_FILE: typeof FRAME_FILE };
export default target;
