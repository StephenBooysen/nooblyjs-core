/**
 * @fileoverview Mail transport for invitation codes and other one-off email
 * (feature 16). Uses nodemailer, an optional peer dependency that is loaded
 * only when a mailer is created, so apps without email never load it.
 *
 * Configuration (explicit options win over environment):
 *   smtpUrl / SMTP_URL   e.g. smtps://user:pass@smtp.example.com:465
 *   from    / MAIL_FROM  e.g. "NooblyJS <no-reply@example.com>"
 *
 * @module notifying/modules/mail
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

/**
 * Creates a mailer. Pass `transport` (any object with `sendMail`) to use a
 * custom or test transport instead of nodemailer.
 *
 * @param {Object=} options
 * @param {string=} options.smtpUrl SMTP connection URL (defaults to SMTP_URL).
 * @param {string=} options.from Sender address (defaults to MAIL_FROM).
 * @param {Object=} options.transport Pre-built transport with `sendMail`.
 * @param {Object=} options.logger Optional logger.
 * @return {?{send: function(Object): Promise<void>}} The mailer, or null when
 *     no SMTP URL and no transport are configured.
 * @throws {Error} When nodemailer is not installed and a SMTP URL is set.
 * @example
 * const mailer = createMailer({ smtpUrl: process.env.SMTP_URL, from: process.env.MAIL_FROM });
 * if (mailer) await mailer.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello' });
 */
function createMailer(options = {}) {
  const smtpUrl = options.smtpUrl || process.env.SMTP_URL;
  const from = options.from || process.env.MAIL_FROM;
  let transport = options.transport || null;

  if (!transport) {
    if (!smtpUrl) return null;
    const nodemailer = requireOptional('nodemailer', "notifying mail (SMTP_URL)");
    transport = nodemailer.createTransport(smtpUrl);
  }
  if (typeof transport.sendMail !== 'function') {
    throw new Error('Mail transport must provide sendMail()');
  }

  return {
    /**
     * Sends one plain-text message.
     * @param {{to: string, subject: string, text: string}} message
     * @return {Promise<void>}
     */
    async send({ to, subject, text }) {
      if (!from) {
        throw new Error('MAIL_FROM (or mail.from) is required to send email');
      }
      if (!to || !subject || !text) {
        throw new Error('Mail needs to, subject and text');
      }
      await transport.sendMail({ from, to, subject, text });
      options.logger?.info?.('[mail] message sent', { to, subject });
    }
  };
}

/**
 * Builds the `invitations.sendCode` hook for the authservice from a mailer.
 * The code is sent only to the address the person entered.
 *
 * @param {{send: function(Object): Promise<void>}} mailer Mailer from createMailer.
 * @param {Object=} options
 * @param {string=} options.appName Name shown in the message (default "NooblyJS").
 * @return {function({email: string, name: string, code: string, expiresAt: Date}): Promise<void>}
 */
function invitationCodeSender(mailer, options = {}) {
  const appName = options.appName || 'NooblyJS';
  return async ({ email, name, code, expiresAt }) => {
    const until = expiresAt ? new Date(expiresAt).toUTCString() : 'the time shown on the sign-up page';
    await mailer.send({
      to: email,
      subject: `Your ${appName} invitation code`,
      text: [
        `Hello ${name},`,
        '',
        `Your invitation code is: ${code}`,
        '',
        `Use it to create your account before ${until}. It works once.`,
        '',
        'If you did not ask for this, you can ignore this message.'
      ].join('\n')
    });
  };
}

module.exports = { createMailer, invitationCodeSender };
