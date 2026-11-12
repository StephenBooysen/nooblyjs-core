'use strict';
/** Authservice provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, bool, obj, arr, any, apiProvider } = require('../shared/config/schemaTypes');

const common = {
  invitations: obj('Invitation mode, TTL and delivery (feature 16)'),
  session: obj('idleTimeoutMs, adminIdleTimeoutMs, absoluteTimeoutMs (feature 23)'),
  tokens: obj('defaultExpiryDays, maxExpiryDays, allowNonExpiring (feature 23)'),
  brandingConfig: obj('Login page branding'),
  loginSuccessRedirectUrl: str('Where to go after sign-in'),
  ssoSecret: str('Shared secret for SSO hand-off'),
  ssoAllowedReturnUrls: arr('Allowed SSO return URLs'),
  express: any('Express app (passport providers)'),
  passport: any('Passport instance'),
  loggingLevel: str('Log level'),
  createDefaultAdmin: bool('Create the default admin (memory provider)')
};

module.exports = {
  common: { properties: common },
  providers: {
    memory: { open: true, properties: {} },
    file: { open: true, properties: {} },
    passport: { open: true, properties: {} },
    google: { open: true, properties: { clientID: str('OAuth client id'), clientSecret: str('OAuth client secret'), callbackURL: str('Callback URL') } },
    azure: {
      open: true,
      properties: {
        clientID: str('Entra client id'), clientSecret: str('Client secret'), tenantID: str('Tenant id'), callbackURL: str('Callback URL'),
        redirectUrl: str('Redirect URL'), baseUrl: str('Base URL'), scope: any('Scopes'), userStore: any('User store')
      }
    },
    'secure-email': { open: true, properties: {} },
    api: apiProvider
  }
};
