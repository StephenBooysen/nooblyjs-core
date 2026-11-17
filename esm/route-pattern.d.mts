// Declarations for esm/route-pattern.mjs (src/shared/utils/routePattern.js).

export interface CompiledRoute {
  regexp: RegExp;
  keys: Array<{ name: string | number; optional: boolean; wildcard: boolean }>;
}

/**
 * Turns an Express 4 pattern (`*`, `:name(*)`, `:opt?`) into a regular expression
 * and parameter keys that Express 4 and 5 both accept.
 */
export declare function compileRoute(pattern: string): CompiledRoute;
/** Express-ready route for a pattern. Its `pattern` property keeps the source text. */
export declare function route(pattern: string): RegExp;

declare const target: { route: typeof route; compileRoute: typeof compileRoute };
export default target;
