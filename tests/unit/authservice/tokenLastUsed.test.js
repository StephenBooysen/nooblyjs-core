/**
 * @fileoverview Personal access token last-used time (feature 23): using a token
 * records when it was last used, and the profile listing returns that time so the
 * profile page can show it.
 */
'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '6';

const EventEmitter = require('events');
const createAuthService = require('../../../src/authservice');

const EMAIL = 'lastused@example.com';
const PASSWORD = 'Str0ng!Passw0rd';

function mockApp() {
  return { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() };
}

describe('personal access token last-used time', () => {
  it('is empty until the token is used, then set in the profile listing', async () => {
    const auth = createAuthService('memory', { 'express-app': mockApp(), dependencies: {} }, new EventEmitter());
    await auth.createUser({ email: EMAIL, fullName: 'Last Used', password: PASSWORD, role: 'user' });
    const created = await auth.createApiToken(EMAIL, 'laptop');

    const before = await auth.listApiTokens(EMAIL);
    expect(before).toHaveLength(1);
    expect(before[0].lastUsed).toBeFalsy();
    expect(before[0]).not.toHaveProperty('tokenHash');

    await auth.validateApiToken(created.token);

    const after = await auth.listApiTokens(EMAIL);
    expect(after[0].lastUsed).toBeInstanceOf(Date);
    expect(Date.now() - new Date(after[0].lastUsed).getTime()).toBeLessThan(5000);
  });
});
