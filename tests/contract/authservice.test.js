'use strict';

/**
 * Runs the authservice contract against the memory and file providers (always
 * on in npm test). The file provider works in a temp folder under
 * .temp/tests/data/ and is also checked to keep users across a restart.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { runAuthContract, PASSWORD, NEW_PASSWORD } = require('./authservice.contract');
const { testDataDir } = require('../helpers/testData');
const createAuth = require('../../src/authservice');

runAuthContract('memory', () => createAuth('memory', { dependencies: {} }, new EventEmitter()));

let dir;
const openFile = async (dataDir) => {
  const auth = createAuth('file', { dataDir, dependencies: {} }, new EventEmitter());
  await auth.ready;
  return auth;
};

runAuthContract(
  'file',
  () => {
    dir = fs.mkdtempSync(path.join(testDataDir('contract'), 'auth-'));
    return openFile(dir);
  },
  async () => { fs.rmSync(dir, { recursive: true, force: true }); }
);

describe('authservice file provider after a restart', () => {
  let base;
  beforeEach(() => { base = fs.mkdtempSync(path.join(testDataDir('contract'), 'auth-restart-')); });
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

  it('keeps users, roles and passwords', async () => {
    const first = await openFile(base);
    await first.createUser({ email: 'grace@example.com', fullName: 'Grace', password: PASSWORD });
    await first.createRole('support');
    await first.addUserToRole('grace@example.com', 'support');
    const second = await openFile(base);
    expect((await second.getUser('grace@example.com')).roles).toContain('support');
    expect(await second.listRoles()).toContain('support');
    expect((await second.getUsersInRole('support')).map((u) => u.email)).toEqual(['grace@example.com']);
    expect((await second.authenticateUser('grace@example.com', PASSWORD)).user.email).toBe('grace@example.com');
  });

  it('keeps a changed password: the old one stays refused', async () => {
    const first = await openFile(base);
    await first.createUser({ email: 'alan@example.com', fullName: 'Alan', password: PASSWORD });
    await first.changePassword('alan@example.com', PASSWORD, NEW_PASSWORD);
    const second = await openFile(base);
    await expect(second.authenticateUser('alan@example.com', PASSWORD)).rejects.toThrow(/Invalid credentials/);
    expect((await second.authenticateUser('alan@example.com', NEW_PASSWORD)).user.email).toBe('alan@example.com');
  });

  it('keeps sessions ended by a role change ended', async () => {
    const first = await openFile(base);
    await first.createUser({ email: 'ada@example.com', fullName: 'Ada', password: PASSWORD });
    const { session } = await first.authenticateUser('ada@example.com', PASSWORD);
    await first.addUserToRole('ada@example.com', 'editor');
    const second = await openFile(base);
    await expect(second.validateSession(session.token)).rejects.toThrow(/Invalid session/);
  });

  it('keeps a deleted role deleted', async () => {
    const first = await openFile(base);
    await first.createRole('temporary');
    await first.deleteRole('temporary');
    const second = await openFile(base);
    expect(await second.listRoles()).not.toContain('temporary');
  });
});
