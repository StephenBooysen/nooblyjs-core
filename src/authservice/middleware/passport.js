'use strict';

/**
 * @fileoverview Passport integration helpers for authservice.
 */

/**
 * Configure a passport instance using the strategy factory provided by the authservice.
 *
 * @param {(Function|Object)} strategyFactoryOrConfig - Factory function (e.g. authservice.getAuthStrategy) or configuration object
 * @param {Object} [passportInstance] - Optional passport instance (defaults to the global passport singleton)
 * @returns {Object} Configured passport instance
 */
function configurePassport(strategyFactoryOrConfig, passportInstance) {
  const passport = passportInstance || require('passport');
  const isFactory = typeof strategyFactoryOrConfig === 'function';
  const strategyConfig = isFactory ? strategyFactoryOrConfig() : strategyFactoryOrConfig;

  if (!strategyConfig || typeof strategyConfig !== 'object') {
    throw new Error('Strategy configuration must be provided as an object or factory function.');
  }

  const { strategy, serializeUser, deserializeUser } = strategyConfig;

  if (!strategy) {
    throw new Error('Strategy configuration must include a strategy instance.');
  }

  passport.use(strategy);

  if (typeof serializeUser === 'function') {
    passport.serializeUser(serializeUser);
  }

  if (typeof deserializeUser === 'function') {
    passport.deserializeUser(deserializeUser);
  }

  return passport;
}

module.exports = {
  configurePassport
};
