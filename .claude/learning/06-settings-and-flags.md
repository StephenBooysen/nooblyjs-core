# 06: Settings and feature flags

**Time:** about 20 minutes · **Example:** [`examples/06-settings-and-flags.js`](examples/06-settings-and-flags.js) · **Run:** `node .claude/learning/examples/06-settings-and-flags.js`

## What you will learn

Store grouped configuration values, keep secrets encrypted, and switch features on for some callers with feature flags.

## Key ideas

- **Settings are grouped.** A value has a key and belongs to a group, such as `mail` or `billing`. The same key can exist in two groups.
- **Encrypted at rest.** The settings file is AES-256-GCM encrypted with a master secret. The secret comes from the option, `SETTINGS_SECRET` or `SESSION_SECRET`. Without one, a built-in development secret is used and a warning is logged: set your own before you store real values.
- **Secrets are masked.** A value stored with `{ secret: true }` is hidden in the dashboard and over REST.
- **Feature flags use the same store.** A flag is a named switch with a rollout percentage, rules and optional variants.
- **Flags are decided per caller.** The decision depends on the caller's id, roles, email domain and the environment. The same flag can be on for one person and off for another.
- **Rollouts are stable.** A caller's bucket is a hash of the flag name and their id, so the same person stays in or out as the percentage grows.

## Walk-through

### Settings

```javascript
const settings = registry.settings('file', {
  filepath: path.join(dataDir, 'settings-06.json'),
  secret: 'learning-secret-0123456789abcdef',
});

await settings.set('smtpHost', 'smtp.example.com', 'mail');
await settings.set('apiToken', 'tok-123', 'mail', { secret: true });
console.log(await settings.get('smtpHost', 'mail'));   // smtp.example.com
```

The example's secret is for learning only. In your app, read it from the environment.

### A flag

```javascript
await settings.flags.set('new-checkout', {
  enabled: true,
  rolloutPercent: 25,
  description: 'The redesigned checkout',
  rules: [{ type: 'role', values: ['beta-tester'] }],
});
```

- `enabled` is the master switch. Off means off for everyone.
- `rolloutPercent` (0 to 100) turns the flag on for that share of callers.
- `rules` turn it on for everyone who matches, whatever the rollout: a `role`, an `emailDomain`, or an `environment`.

### Evaluate it

```javascript
const beta = { userId: 'ada', roles: ['beta-tester'] };
const anyone = { userId: 'grace', roles: ['user'] };

await settings.flags.isEnabled('new-checkout', beta);     // true: the rule matches
await settings.flags.isEnabled('new-checkout', anyone);   // true or false, by the 25% bucket
await settings.flags.evaluate('new-checkout', anyone);    // the full decision, with the reason
```

`evaluate` returns the decision and why it was made, which is useful when someone asks why a feature is missing for them.

### Variants

```javascript
await settings.flags.set('button-colour', {
  enabled: true,
  variants: [{ name: 'control', weight: 50 }, { name: 'green', weight: 50 }],
  defaultVariant: 'control',
});
await settings.flags.variant('button-colour', { userId: 'ada' });   // 'control' or 'green'
```

Weights split the callers, the same way the rollout does: stable per person.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/services/settings/api/groups` | List groups |
| POST | `/services/settings/api/groups` | Create a group |
| GET | `/services/settings/api/values/:group/:key` | Read a value (secrets are masked) |
| PUT | `/services/settings/api/values/:group/:key` | Change a value |
| POST | `/services/settings/api/reload` | Re-read the file from disk |
| GET | `/services/settings/api/flags` | List flags |
| PUT | `/services/settings/api/flags/:name` | Create or replace a flag |
| POST | `/services/settings/api/flags/:name/evaluate` | Evaluate for a caller |

Listing and changing flags needs the `settings:manage` permission, which only admins hold. Evaluating a flag needs `flags:evaluate`, which every role holds.

## Providers

| Type | Notes |
|---|---|
| `file` | JSON file, always encrypted with the secret |
| `encrypted` | The same class as `file` |

## Common mistakes

- **Using the development secret in production.** Anyone with the settings file and the default secret can read it. Set `SETTINGS_SECRET`.
- **Changing the secret.** Values encrypted with the old secret cannot be read with the new one. Rotate with a migration, not by changing the variable.
- **Gating security decisions on a flag.** A flag hides a feature. It is not an access control: the server must still check permissions.
- **Using flags for per-user settings.** A flag is a yes or no. A setting with a value belongs in a group.
- **Expecting a rollout to be random per request.** It is per person, by design. The same caller always gets the same answer for the same flag.

## Try it

1. Set the rollout to 0, then to 100, and check how the answer changes for the same caller.
2. Give a caller the role `beta-tester` through a rule, and remove the rule. Use `evaluate` to see the reason change.
3. Read `apiToken` over REST and check that the value is masked.
