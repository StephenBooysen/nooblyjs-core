'use strict';
// Example 14: the authservice service: users, roles, sessions and tokens.
const { registry, call, done } = require('./setup');

(async () => {
  // 'memory' keeps users in process (tests and demos). 'file' stores them in
  // a JSON file; the default and production choices are listed in the tutorial.
  const auth = registry.authservice('memory');

  // Create a user. Passwords must pass the strength policy.
  const user = await auth.createUser({
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    password: 'Str0ng!Pass#2026',
    role: 'editor',
  });
  console.log('created', user.email, user.roles);

  // A weak password is refused with a message that says why.
  try {
    await auth.createUser({ email: 'weak@example.com', fullName: 'Weak', password: 'password', role: 'user' });
  } catch (err) {
    console.log('weak password refused:', err.message);
  }

  // Sign in. The result has the user and a session token.
  const { session } = await auth.authenticateUser('ada@example.com', 'Str0ng!Pass#2026');
  console.log('session token issued', typeof session.token === 'string');

  // Check a token, then end the session.
  // validateSession returns the session when it is valid and throws when it is not.
  const isValid = async (token) => {
    try {
      await auth.validateSession(token);
      return true;
    } catch (_err) {
      return false;
    }
  };
  console.log('valid before logout', await isValid(session.token));
  await auth.logout(session.token);
  console.log('valid after logout', await isValid(session.token));

  // A personal access token lets a script act as this user. Its scopes can
  // only narrow what the owner may do.
  const token = await auth.createApiToken('ada@example.com', 'ci-script', { scopes: ['filing:read'] });
  console.log('token prefix', String(token.token ?? token.value ?? '').slice(0, 4));

  // Changing a password ends the user's other sessions.
  await auth.changePassword('ada@example.com', 'Str0ng!Pass#2026', 'An0ther!Pass#2026');

  // Over REST (the examples' key is an admin-level key here).
  const status = await call('GET', '/services/authservice/api/status');
  console.log('rest status', status.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
