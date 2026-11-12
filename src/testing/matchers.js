/**
 * @fileoverview Jest matchers for NooblyJS events (feature 11).
 *
 *   expect(t.events).toHaveEmitted('cache:put:default', { key: 'k' });
 *
 * The received value is an event emitter from createTestRegistry(), which
 * records every emit in `recorded`. The payload is a partial match: every key
 * given must be present with an equal value (nested objects match partially).
 *
 * @module testing/matchers
 */

'use strict';

/**
 * Whether `actual` contains every property of `expected`, recursively.
 * @param {*} actual
 * @param {*} expected
 * @return {boolean}
 */
function partialMatch(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length
      && expected.every((item, i) => partialMatch(actual[i], item));
  }
  return Object.keys(expected).every((key) => partialMatch(actual[key], expected[key]));
}

const matchers = {
  /**
   * Passes when the emitter recorded `eventName`, with a payload that contains
   * `payload` (when given).
   *
   * @param {!Object} received An emitter from createTestRegistry (has `recorded`)
   * @param {string} eventName
   * @param {Object=} payload Partial payload to match
   */
  toHaveEmitted(received, eventName, payload) {
    const recorded = Array.isArray(received?.recorded) ? received.recorded : null;
    if (!recorded) {
      return {
        pass: false,
        message: () => 'toHaveEmitted needs an event emitter from createTestRegistry() (its `events`)'
      };
    }
    const matches = recorded.filter((entry) => entry.name === eventName);
    const pass = matches.some((entry) => payload === undefined || partialMatch(entry.args[0], payload));
    const seen = recorded.map((e) => e.name);
    return {
      pass,
      message: () => (pass
        ? `expected "${eventName}" not to be emitted${payload ? ' with that payload' : ''}`
        : `expected "${eventName}" to be emitted${payload ? ` with ${JSON.stringify(payload)}` : ''}. `
          + (matches.length ? `It was emitted with: ${JSON.stringify(matches.map((m) => m.args[0]))}` : `Emitted events: ${seen.join(', ') || 'none'}`))
    };
  }
};

/**
 * Adds the matchers to Jest's expect.
 * @param {Object=} expectLib Defaults to the global expect
 * @return {void}
 */
function install(expectLib) {
  const target = expectLib || (typeof expect !== 'undefined' ? expect : null);
  if (!target || typeof target.extend !== 'function') {
    throw new Error('installMatchers() needs Jest: call it inside a Jest test file');
  }
  target.extend(matchers);
}

module.exports = { matchers, install, partialMatch };
