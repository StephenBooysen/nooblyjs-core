# 14: Auth service

**Time:** about 25 minutes · **Example:** [`examples/14-authservice.js`](examples/14-authservice.js) · **Run:** `node .claude/learning/examples/14-authservice.js`

## What you will learn

Create users with a password policy, sign them in, check and end sessions, issue personal access tokens with narrower scopes, and understand how the auth service controls access to the dashboard and the API.

## Key ideas

- **Users have roles.** `admin` can do everything. `editor` can read and write most data services. `user` can read filing and searching and use feature flags. The full table is in the [README](../../README.md#route-permissions).
- **Passwords must pass a policy.** At least 10 characters, with upper and lower case, a digit and a symbol. A weak password is refused with each rule it breaks.
- **Sessions are tokens.** `authenticateUser` returns a session with a token. Send the token back to check it. A session ends on logout, after an idle timeout (30 minutes for admins, 8 hours for others), or when the user's password changes.
- **Validation throws.** `validateSession` returns the session when the token is valid and throws (`Invalid session`, `Session expired`, `Session revoked`) when it is not. Wrap it in `try` and treat a throw as "not signed in".
- **Personal access tokens.** A token starts with `dtk_`. Its scopes can only narrow what its owner can do, never widen it. Show the value once; store it like a password.
- **Two gates.** The portal guard decides who may open the dashboard and admin API. The route permission gate decides what each API route allows. Both apply.

## Walk-through

### Create a user

```javascript
const auth = registry.authservice('memory');

await auth.createUser({
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  password: 'Str0ng!Pass#2026',
  role: 'editor',
});
```

A weak password is refused:

```
Password does not meet strength requirements: Password must be at least 10 characters, ...
```

### Sign in and check the session

```javascript
const { session } = await auth.authenticateUser('ada@example.com', 'Str0ng!Pass#2026');

await auth.validateSession(session.token);   // returns the session while it is valid
await auth.logout(session.token);            // ends it
```

A wrong password is refused with `Invalid credentials`.

### A personal access token

```javascript
const token = await auth.createApiToken('ada@example.com', 'ci-script', { scopes: ['filing:read'] });
```

The token can read filing and nothing else, even though Ada is an editor. Its value is returned once, when it is created: the service stores only a SHA-256 hash of it.

### Change a password

```javascript
await auth.changePassword('ada@example.com', 'Str0ng!Pass#2026', 'An0ther!Pass#2026');
```

This ends the user's other sessions.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/authservice/api/register` | Register (when sign-up is open) |
| POST | `/services/authservice/api/login` | Sign in |
| POST | `/services/authservice/api/logout` | Sign out |
| GET | `/services/authservice/api/auth/check` | Is the caller signed in |
| POST | `/services/authservice/api/auth/password/validate` | Check a password against the policy |
| GET | `/services/authservice/api/users` | List users (admin) |
| POST | `/services/authservice/api/users` | Create a user (admin) |
| PUT | `/services/authservice/api/users/:email` | Change a user |
| GET/POST | `/services/authservice/api/roles` | List or create roles |
| GET | `/services/authservice/api/profile/tokens` | The caller's personal access tokens |
| POST | `/services/authservice/api/profile/tokens` | Create a token |
| POST | `/services/authservice/api/invitations` | Invite a person (see below) |
| POST | `/services/authservice/api/invitations/:code/redeem` | Redeem an invitation with a password |

Public routes (register, login, status) need no permission. Everything under `users` and `roles` is for admins.

## Invitations

The default invitation mode is `admin-approval`: a person asks for access, an admin approves the request, and a code is issued. The code is sent by email when `SMTP_URL` is set; otherwise the admin shares it. The person redeems the code with a password. Other modes are `admin-only` (only admins invite), `domain-allowlist` (anyone with an allowed email domain may ask) and `open`. A code is hashed in storage and expires. After five failed redeems the code is revoked.

## Providers

| Type | Stores users in | Use it for |
|---|---|---|
| `memory` | The process | Tests and examples |
| `file` | An encrypted JSON file | A single server |
| `passport` | Your sign-in provider through Passport | Existing login flows |
| `google` | Google OAuth | Sign in with Google |
| `azure` | Azure AD (Entra ID) | Sign in with Microsoft accounts |
| `secure-email` | Email plus a pre-shared secure key, from a JSON file | Teams and Edge extensions |
| `api` | A remote auth service | Sharing users across apps |

## Common mistakes

- **Storing the password in your own table.** Let the auth service hash and check it.
- **Treating `validateSession` as a boolean.** It throws when the token is bad. Catch it.
- **Giving every user the admin role.** Admins can change users and roles, and read everything. Start with `user` and add rights as needed.
- **Keeping a personal access token in source code.** Anyone who reads the repository can use it. Put it in the environment or a secret store.
- **Expecting a session to outlive a password change.** A password change ends the user's sessions, so the user signs in again.

## Try it

1. Create a user with a weak password and read every rule that it breaks.
2. Sign in, check the session, log out, and check again. Note the error the second check throws.
3. Create a token with `filing:read`, then try to give it `users:write` and read the refusal.
