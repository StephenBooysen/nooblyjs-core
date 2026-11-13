'use strict';

/**
 * @fileoverview Invitation codes and onboarding policy (feature 16).
 *
 * Invitation codes are the only credential that creates an account, so they
 * are treated like passwords: 128 bits of randomness, stored only as a SHA-256
 * hash, compared in constant time, single use and time-limited. The onboarding
 * mode decides who can turn a request into a usable code. The default requires
 * an administrator.
 *
 * @module authservice/modules/invitations
 */

const crypto = require('crypto');

/** Invitation lifetime after approval. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Onboarding modes, from safest to most permissive. */
const INVITATION_MODES = Object.freeze(['admin-approval', 'admin-only', 'domain-allowlist', 'open']);

/** Mode used when none is configured. */
const DEFAULT_INVITATION_MODE = 'admin-approval';

/**
 * Generates a new invitation code: 128 bits from the system CSPRNG.
 *
 * @return {string} A code such as `INV-3F9A…` (36 characters)
 */
function generateInvitationCode() {
  return 'INV-' + crypto.randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Hashes an invitation code for storage and lookup.
 *
 * @param {string} code - The plain invitation code
 * @return {string} Hex SHA-256 digest
 */
function hashInvitationCode(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

/**
 * Checks a presented code against a stored hash in constant time.
 *
 * @param {string} presentedCode - The code the caller submitted
 * @param {string} storedHash - The hash stored on the invitation
 * @return {boolean} True when the code matches the hash
 */
function codeMatchesHash(presentedCode, storedHash) {
  if (typeof presentedCode !== 'string' || typeof storedHash !== 'string') return false;
  const a = Buffer.from(hashInvitationCode(presentedCode), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Resolves and validates the `invitations` configuration block.
 *
 * @param {Object=} config - `{ mode, allowedDomains, deliverCode }`
 * @return {{mode: string, allowedDomains: string[], deliverCode: ?Function}}
 * @throws {Error} When the mode is unknown
 *
 * @example
 * resolveInvitationPolicy({ mode: 'domain-allowlist', allowedDomains: ['acme.com'] });
 */
function resolveInvitationPolicy(config = {}) {
  const mode = (config && config.mode) || DEFAULT_INVITATION_MODE;
  if (!INVITATION_MODES.includes(mode)) {
    throw new Error(`Unknown invitations.mode "${mode}". Use one of: ${INVITATION_MODES.join(', ')}`);
  }
  const allowedDomains = Array.isArray(config && config.allowedDomains)
    ? config.allowedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : [];
  const deliverCode = config && typeof config.deliverCode === 'function' ? config.deliverCode : null;
  return { mode, allowedDomains, deliverCode };
}

/**
 * Returns the lower-cased domain part of an email address.
 *
 * @param {string} email - Email address
 * @return {string} The domain, or '' when there is none
 */
function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : '';
}

/**
 * Builds the client-safe view of an invitation. Never includes the code hash.
 *
 * @param {Object} invitation - Stored invitation record
 * @return {Object} `{ id, name, email, mobile, status, createdAt, approvedAt, usedAt, expiresAt }`
 */
function publicInvitation(invitation) {
  return {
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    mobile: invitation.mobile,
    status: invitation.status,
    createdAt: invitation.createdAt,
    approvedAt: invitation.approvedAt,
    usedAt: invitation.usedAt,
    expiresAt: invitation.expiresAt
  };
}

module.exports = {
  INVITATION_TTL_MS,
  INVITATION_MODES,
  DEFAULT_INVITATION_MODE,
  generateInvitationCode,
  hashInvitationCode,
  codeMatchesHash,
  resolveInvitationPolicy,
  emailDomain,
  publicInvitation
};
