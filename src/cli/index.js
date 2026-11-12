/**
 * @fileoverview Command dispatcher for `nooblyjs` (feature 09).
 *
 *   nooblyjs create <dir> [--template api|dashboard|ai] [--force]
 *   nooblyjs doctor [--dir .] [--skip-audit]
 *   nooblyjs routes --url <base> [--key <key>]
 *   nooblyjs openapi --url <base> [--key <key>] [--format json|yaml] [--client ts] [--out <dir>]
 *   nooblyjs mcp --url <base> [--key <key>]          (stdio bridge for coding agents)
 *   nooblyjs keys generate [--length 32]
 *
 * Every command takes flags, so agents and CI can run it without prompts. The
 * commands take their input and output streams from `io`, so tests can drive them.
 *
 * @module cli
 */

'use strict';

const { parseArgs } = require('node:util');

const COMMANDS = {
  create: () => require('./commands/create'),
  doctor: () => require('./commands/doctor'),
  routes: () => require('./commands/routes'),
  openapi: () => require('./commands/openapi'),
  mcp: () => require('./commands/mcp'),
  keys: () => require('./commands/keys')
};

const USAGE = `nooblyjs — create, check and connect NooblyJS apps

Usage:
  nooblyjs create <dir> [--template api|dashboard|ai] [--force]
  nooblyjs doctor [--dir <path>] [--skip-audit] [--json]
  nooblyjs routes --url <base-url> [--key <api-key>]
  nooblyjs openapi --url <base-url> [--key <api-key>] [--format json|yaml] [--client ts] [--out <dir>]
  nooblyjs mcp --url <base-url> [--key <api-key>] [--allow-write]
  nooblyjs keys generate [--length 32]

Environment: NOOBLYJS_API_KEY is used when --key is not given.
`;

/**
 * Runs a command.
 *
 * @param {Array<string>} argv Arguments after the program name.
 * @param {Object=} io Streams and environment; defaults to the process's.
 * @param {!Object=} io.stdout Writable with write()
 * @param {!Object=} io.stderr Writable with write()
 * @param {!Object=} io.stdin Async iterable of lines (mcp)
 * @param {string=} io.cwd Working directory
 * @param {Object=} io.env Environment variables
 * @param {Function=} io.fetch fetch implementation
 * @return {Promise<number>} Exit code
 */
async function main(argv, io = {}) {
  const streams = {
    stdout: io.stdout || process.stdout,
    stderr: io.stderr || process.stderr,
    stdin: io.stdin || process.stdin,
    cwd: io.cwd || process.cwd(),
    env: io.env || process.env,
    fetch: io.fetch || globalThis.fetch
  };
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    streams.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  if (command === '--version' || command === '-v') {
    streams.stdout.write(`${require('../../package.json').version}\n`);
    return 0;
  }
  const load = COMMANDS[command];
  if (!load) {
    streams.stderr.write(`nooblyjs: unknown command "${command}"\n\n${USAGE}`);
    return 1;
  }
  try {
    return await load().run(rest, streams, parseArgs);
  } catch (error) {
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      streams.stderr.write(`nooblyjs ${command}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

module.exports = { main, USAGE };
