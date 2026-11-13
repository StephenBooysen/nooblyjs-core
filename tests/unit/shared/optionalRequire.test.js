/**
 * @fileoverview Tests for the optional-dependency loader (feature 20b).
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { loadOptionalModule } = require('../../../src/shared/utils/optionalRequire');

describe('loadOptionalModule', () => {
  it('returns an installed module', () => {
    expect(loadOptionalModule('express', 'test').Router).toBeDefined();
  });

  it('explains how to install a missing package', () => {
    expect(() => loadOptionalModule('@nooblyjs-not-installed/sdk', 'Test'))
      .toThrow('The Test provider needs the "@nooblyjs-not-installed/sdk" package. Install it with: npm install @nooblyjs-not-installed/sdk');
  });

  it('rethrows other load errors unchanged', () => {
    // A module that exists but throws while loading keeps its own error.
    jest.doMock('nooblyjs-broken-fixture', () => { throw new Error('boom'); }, { virtual: true });
    expect(() => loadOptionalModule('nooblyjs-broken-fixture', 'x')).toThrow('boom');
    jest.dontMock('nooblyjs-broken-fixture');
  });
});
