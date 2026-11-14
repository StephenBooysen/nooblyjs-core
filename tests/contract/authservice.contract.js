/**
 * @fileoverview Contract every local authservice provider must pass (feature 11):
 * users, password checks, sessions, roles, API tokens and password changes. No
 * provider may return a password hash. Runners call
 * `runAuthContract(name, make, teardown)` with the service from `src/authservice`.
 */
'use strict';

const PASSWORD = 'Str0ng!Passw0rd#2026';
const NEW_PASSWORD = 'An0ther!Passw0rd#2026';
const SECRET_FIELDS = /pass|hash|salt/i;

/**
 * @param {string} name Provider name, used in the suite title
 * @param {Function} makeAuth Returns an authservice (may be async)
 * @param {Function} [teardown] Releases it after each test
 * @return {void}
 */
function runAuthContract(name, makeAuth, teardown = async () => {}) {
  describe(`authservice contract: ${name}`, () => {
    let auth;
    let n = 0;
    const email = (label) => `${label}.${Date.now()}.${n++}@example.com`;
    const newUser = (address, extra = {}) => auth.createUser({ email: address, fullName: 'Contract User', password: PASSWORD, ...extra });
    const secretKeys = (obj) => Object.keys(obj || {}).filter((k) => SECRET_FIELDS.test(k));

    beforeEach(async () => { auth = await makeAuth(); });
    afterEach(async () => { await teardown(auth); });

    it('creates a user and never returns the password or its hash', async () => {
      const address = email('create');
      const user = await newUser(address);
      expect(user).toEqual(expect.objectContaining({ email: address, fullName: 'Contract User', roles: expect.any(Array) }));
      expect(secretKeys(user)).toEqual([]);
      expect(secretKeys(await auth.getUser(address))).toEqual([]);
      expect((await auth.listUsers()).flatMap(secretKeys)).toEqual([]);
    });

    it('refuses a second user with the same email, and a weak password', async () => {
      const address = email('dup');
      await newUser(address);
      await expect(newUser(address)).rejects.toThrow(/already exists/);
      await expect(newUser(email('weak'), { password: 'abc' })).rejects.toThrow(/strength/);
    });

    it('signs in with the right password only, and the session is valid until logout', async () => {
      const address = email('login');
      await newUser(address);
      await expect(auth.authenticateUser(address, 'wrong')).rejects.toThrow(/Invalid credentials/);
      await expect(auth.authenticateUser(email('nobody'), PASSWORD)).rejects.toThrow(/Invalid credentials/);
      const { session, user } = await auth.authenticateUser(address, PASSWORD);
      expect(user.email).toBe(address);
      expect(secretKeys(user)).toEqual([]);
      expect((await auth.validateSession(session.token)).email).toBe(address);
      await auth.logout(session.token);
      await expect(auth.validateSession(session.token)).rejects.toThrow(/Invalid session/);
    });

    it('updates a user and refuses unknown users', async () => {
      const address = email('update');
      await newUser(address);
      expect((await auth.updateUser(address, { fullName: 'Renamed' })).fullName).toBe('Renamed');
      expect((await auth.getUser(address)).fullName).toBe('Renamed');
      await expect(auth.getUser(email('missing'))).rejects.toThrow(/User not found/);
    });

    it('has the standard roles, adds new ones, and ends sessions when a role is assigned', async () => {
      expect(await auth.listRoles()).toEqual(expect.arrayContaining(['admin', 'editor', 'user', 'guest']));
      const role = `support${n++}`;
      await auth.createRole(role);
      await expect(auth.createRole(role)).rejects.toThrow(/already exists/);
      const address = email('role');
      await newUser(address);
      const { session } = await auth.authenticateUser(address, PASSWORD);
      await auth.addUserToRole(address, role);
      expect((await auth.getUsersInRole(role)).map((u) => u.email ?? u)).toContain(address);
      expect((await auth.getUser(address)).roles).toContain(role);
      await expect(auth.validateSession(session.token)).rejects.toThrow(/Invalid session/);
    });

    it('changes a password only with the current one, and the old one stops working', async () => {
      const address = email('password');
      await newUser(address);
      await expect(auth.changePassword(address, 'wrong', NEW_PASSWORD)).rejects.toThrow(/incorrect/);
      expect(secretKeys(await auth.changePassword(address, PASSWORD, NEW_PASSWORD))).toEqual([]);
      await expect(auth.authenticateUser(address, PASSWORD)).rejects.toThrow(/Invalid credentials/);
      expect((await auth.authenticateUser(address, NEW_PASSWORD)).user.email).toBe(address);
    });

    it('issues an API token once, lists it without the secret, and revokes it', async () => {
      const address = email('token');
      await newUser(address);
      const created = await auth.createApiToken(address, 'ci');
      expect(created).toEqual(expect.objectContaining({ id: expect.any(String), token: expect.any(String), name: 'ci' }));
      expect((await auth.validateApiToken(created.token)).email).toBe(address);
      const listed = await auth.listApiTokens(address);
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty('token');
      await auth.deleteApiToken(address, created.id);
      await expect(auth.validateApiToken(created.token)).rejects.toThrow(/Invalid API token/);
      await expect(auth.validateApiToken('not-a-token')).rejects.toThrow(/Invalid API token/);
    });

    it('deletes a user, who can then no longer sign in', async () => {
      const address = email('delete');
      await newUser(address);
      await auth.deleteUser(address);
      await expect(auth.getUser(address)).rejects.toThrow(/User not found/);
      await expect(auth.authenticateUser(address, PASSWORD)).rejects.toThrow(/Invalid credentials/);
      await expect(auth.deleteUser(address)).rejects.toThrow(/User not found/);
    });
  });
}

module.exports = { runAuthContract, PASSWORD, NEW_PASSWORD };
