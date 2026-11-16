'use strict';
// Example 06: the settings service, and feature flags stored in it.
const path = require('node:path');
const { registry, call, done, dataDir } = require('./setup');

(async () => {
  // Settings are grouped key/value pairs in a JSON file, encrypted with
  // AES-256-GCM. The secret comes from the option, SETTINGS_SECRET or
  // SESSION_SECRET. Without any of them the built-in development secret is
  // used and a warning is logged, so set one before you store real values.
  const settings = registry.settings('file', {
    filepath: path.join(dataDir, 'settings-06.json'),
    secret: 'learning-secret-0123456789abcdef',
  });

  // Write and read a grouped value. Values flagged as secrets are masked in
  // the dashboard and over REST.
  await settings.set('smtpHost', 'smtp.example.com', 'mail');
  await settings.set('apiToken', 'tok-123', 'mail', { secret: true });
  console.log('smtpHost', await settings.get('smtpHost', 'mail'));

  // Feature flags live in the same store. A flag has an on/off switch, a
  // percentage rollout, rules and optional variants.
  await settings.flags.set('new-checkout', {
    enabled: true,
    rolloutPercent: 25,
    description: 'The redesigned checkout',
    rules: [{ type: 'role', values: ['beta-tester'] }],
  });

  // Evaluate for a caller. A beta tester is always in; anyone else is in
  // when their id falls inside the 25% rollout.
  const beta = { userId: 'ada', roles: ['beta-tester'] };
  const anyone = { userId: 'grace', roles: ['user'] };
  console.log('beta tester sees it', await settings.flags.isEnabled('new-checkout', beta));
  console.log('anyone sees it', await settings.flags.isEnabled('new-checkout', anyone));
  console.log('decision for anyone', await settings.flags.evaluate('new-checkout', anyone));

  // Variants split a flag into weighted options, for experiments.
  await settings.flags.set('button-colour', {
    enabled: true,
    variants: [{ name: 'control', weight: 50 }, { name: 'green', weight: 50 }],
    defaultVariant: 'control',
  });
  console.log('variant', await settings.flags.variant('button-colour', { userId: 'ada' }));

  // Over REST: list the flags and read a setting.
  const flags = await call('GET', '/services/settings/api/flags');
  console.log('rest flags', flags.status, flags.body.flags?.length ?? flags.body);
  const value = await call('GET', '/services/settings/api/values/mail/smtpHost');
  console.log('rest value', value.status, value.body);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
