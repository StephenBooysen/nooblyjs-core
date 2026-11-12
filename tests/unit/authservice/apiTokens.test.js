/**
 * @fileoverview Unit tests for user-issued API (personal access) tokens.
 *
 * Covers the token lifecycle on the auth provider engine: creation, the
 * `dtk_` wire format, hashed-at-rest storage, validation with live role
 * resolution, expiry enforcement, revocation, inactive-account handling,
 * the persistence hook, and lazy index rebuild (the post-restart path).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

// Keep bcrypt hashing fast in tests (must be set before the provider is required).
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '6';

const createAuthService = require('../../../src/authservice');
const EventEmitter = require('events');

const PASSWORD = 'Str0ng!Passw0rd';
const EMAIL = 'tokuser@example.com';

/** Minimal Express app stub so the route factory can register handlers. */
function mockApp() {
  return {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn()
  };
}

/**
 * Creates a fresh in-memory auth provider with one non-admin user.
 * @return {Promise<{auth: Object, emitter: EventEmitter}>}
 */
async function freshAuthWithUser() {
  const emitter = new EventEmitter();
  const auth = createAuthService('memory', {
    'express-app': mockApp(),
    dependencies: {}
  }, emitter);

  await auth.createUser({
    email: EMAIL,
    fullName: 'Token User',
    password: PASSWORD,
    role: 'user'
  });

  return { auth, emitter };
}

describe('API token engine', () => {
  describe('createApiToken', () => {
    it('issues a dtk_-prefixed secret with metadata and never stores the raw secret', async () => {
      const { auth } = await freshAuthWithUser();

      const created = await auth.createApiToken(EMAIL, 'CI token');

      expect(created.token).toMatch(/^dtk_[0-9a-f]{64}$/);
      expect(created.id).toMatch(/^tok_/);
      expect(created.tokenPrefix).toBe(created.token.substring(0, 12));
      // Feature 23: tokens expire after 90 days unless told otherwise.
      const days = (new Date(created.expiresAt) - Date.now()) / 86400000;
      expect(days).toBeGreaterThan(89.9);
      expect(days).toBeLessThanOrEqual(90);
      expect(created.createdAt).toBeInstanceOf(Date);

      // The stored record holds only the hash, not the secret.
      const stored = auth.users_.get(EMAIL).apiTokens[0];
      expect(stored.token).not.toBe(created.token);
      expect(stored.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects missing email or name', async () => {
      const { auth } = await freshAuthWithUser();
      await expect(auth.createApiToken('', 'x')).rejects.toThrow(/required/);
      await expect(auth.createApiToken(EMAIL, '')).rejects.toThrow(/required/);
    });

    it('throws for an unknown user', async () => {
      const { auth } = await freshAuthWithUser();
      await expect(auth.createApiToken('nobody@example.com', 'x'))
        .rejects.toThrow('User not found');
    });

    it('honours expiresInDays by setting a future expiry', async () => {
      const { auth } = await freshAuthWithUser();
      const before = Date.now();
      const created = await auth.createApiToken(EMAIL, 'expiring', { expiresInDays: 30 });
      const expiry = new Date(created.expiresAt).getTime();
      expect(expiry).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
      expect(expiry).toBeLessThan(before + 31 * 24 * 60 * 60 * 1000);
    });
  });

  describe('validateApiToken', () => {
    it('resolves the owning identity with live roles', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');

      const result = await auth.validateApiToken(created.token);

      expect(result.email).toBe(EMAIL);
      expect(result.roles).toEqual(['user']);
      expect(result.user.email).toBe(EMAIL);
      expect(result.user.fullName).toBe('Token User');
      expect(result.token.id).toBe(created.id);
      // The hashed secret is never leaked back to callers.
      expect(result.token.token).toBeUndefined();
    });

    it('reflects role changes made after the token was issued (live, not snapshotted)', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');

      // Promote the user after issuing the token.
      auth.users_.get(EMAIL).roles = ['user', 'admin'];

      const result = await auth.validateApiToken(created.token);
      expect(result.roles).toEqual(['user', 'admin']);
    });

    it('records lastUsed on validation', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');
      expect(auth.users_.get(EMAIL).apiTokens[0].lastUsed).toBeNull();

      await auth.validateApiToken(created.token);
      expect(auth.users_.get(EMAIL).apiTokens[0].lastUsed).toBeInstanceOf(Date);
    });

    it('rejects an unknown or tampered token', async () => {
      const { auth } = await freshAuthWithUser();
      await auth.createApiToken(EMAIL, 't');
      await expect(auth.validateApiToken('dtk_deadbeef')).rejects.toThrow('Invalid API token');
      await expect(auth.validateApiToken('')).rejects.toThrow('Token is required');
    });

    it('rejects an expired token', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 'expired', {
        expiresAt: new Date(Date.now() - 1000)
      });
      await expect(auth.validateApiToken(created.token)).rejects.toThrow('expired');
    });

    it('rejects a token whose owner is inactive', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');
      auth.users_.get(EMAIL).isActive = false;
      await expect(auth.validateApiToken(created.token)).rejects.toThrow('inactive');
    });

    it('rebuilds its lookup index lazily (simulates loading tokens from disk after restart)', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');

      // Wipe the in-memory index as though the process had just restarted and
      // loaded users (with their apiTokens) from storage.
      auth.tokenIndex_ = new Map();
      auth.tokenIndexBuilt_ = false;

      const result = await auth.validateApiToken(created.token);
      expect(result.email).toBe(EMAIL);
    });
  });

  describe('listApiTokens / deleteApiToken', () => {
    it('lists tokens without secrets and revokes them', async () => {
      const { auth } = await freshAuthWithUser();
      const created = await auth.createApiToken(EMAIL, 't');

      let list = await auth.listApiTokens(EMAIL);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].token).toBeUndefined();

      await auth.deleteApiToken(EMAIL, created.id);

      list = await auth.listApiTokens(EMAIL);
      expect(list).toHaveLength(0);
      // A revoked token no longer validates.
      await expect(auth.validateApiToken(created.token)).rejects.toThrow('Invalid API token');
    });

    it('throws when revoking an unknown token', async () => {
      const { auth } = await freshAuthWithUser();
      await expect(auth.deleteApiToken(EMAIL, 'tok_missing')).rejects.toThrow('Token not found');
    });
  });

  describe('persistence hook', () => {
    it('persists via saveUsersToFile_ on create and delete when available', async () => {
      const { auth } = await freshAuthWithUser();
      auth.saveUsersToFile_ = jest.fn().mockResolvedValue(undefined);

      const created = await auth.createApiToken(EMAIL, 't');
      expect(auth.saveUsersToFile_).toHaveBeenCalledTimes(1);

      await auth.deleteApiToken(EMAIL, created.id);
      expect(auth.saveUsersToFile_).toHaveBeenCalledTimes(2);
    });
  });
});
