/**
 * @fileoverview `nooblyjs` command-line tool (feature 09).
 *
 * Commands: create, doctor, routes, openapi, keys generate, mcp, help. Every
 * command takes its input from flags and environment variables, so agents and CI
 * can run it without prompts. `main()` returns an exit code and never calls
 * process.exit, so tests can drive it.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { parseArgs } = require('node:util');

const HELP = `nooblyjs - tools for NooblyJS Core apps

Usage:
  nooblyjs create <dir> [--yes] [--template api]   Write a minimal API app into <dir>
  nooblyjs doctor [--skip-audit] [--dir <path>]    Check the environment; exits 1 on failure
  nooblyjs routes [--url <url>]                    List the API operations of a running app
  nooblyjs openapi [--url <url>] [--out <file>] [--client ts]
                                                   Write the OpenAPI document, or a typed TypeScript client
  nooblyjs keys generate [--length <n>]            Print a random API key
  nooblyjs mcp [--url <url>]                       Stdio bridge to a running app's MCP endpoint
  nooblyjs help                                    Show this help

Environment:
  NOOBLYJS_URL          app base URL for routes, openapi and mcp (default http://localhost:9000)
  NOOBLYJS_API_KEY      API key sent as x-api-key
  NOOBLYJS_TOKEN        personal access token sent as a Bearer token
`;

const COMMANDS = {
  create: () => require('./create').run,
  doctor: () => require('./doctor').run,
  routes: () => require('./remote').routes,
  openapi: () => require('./remote').openapi,
  keys: () => require('./keys').run,
  mcp: () => require('./mcp').run
};

/**
 * Runs the CLI.
 *
 * @param {string[]} argv Arguments after the program name
 * @param {Object} [io] Injectable streams and environment (for tests)
 * @param {Object} [io.stdin] Readable for the mcp bridge
 * @param {Object} [io.stdout] Writable, defaults to process.stdout
 * @param {Object} [io.stderr] Writable, defaults to process.stderr
 * @param {Object} [io.env] Environment, defaults to process.env
 * @param {Function} [io.fetch] fetch implementation, defaults to the global one
 * @param {string} [io.cwd] Working directory, defaults to process.cwd()
 * @return {Promise<number>} Exit code
 */
async function main(argv, io = {}) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const env = io.env || process.env;
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    out.write(HELP);
    return 0;
  }
  const load = COMMANDS[command];
  if (!load) {
    err.write(`Unknown command "${command}". Run "nooblyjs help".\n`);
    return 2;
  }
  try {
    return await load()(rest, { ...io, stdout: out, stderr: err, env });
  } catch (error) {
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || error.usage) {
      err.write(`${error.message}\n\n${HELP}`);
      return 2;
    }
    err.write(`nooblyjs ${command}: ${error.message}\n`);
    return 1;
  }
}

/**
 * Parses flags with node:util parseArgs, turning a bad flag into a usage error.
 *
 * @param {string[]} args Arguments
 * @param {Object} options parseArgs options
 * @return {{values: Object, positionals: string[]}}
 * @throws {Error} When a flag is unknown or malformed
 */
function parse(args, options) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

module.exports = { main, parse, HELP };
