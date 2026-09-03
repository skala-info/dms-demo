// integrations/email/base.js — the email port.
//
// Services depend on this interface only. Swapping SES/Postmark in later means adding an
// adapter here and changing EMAIL_PROVIDER; nothing above this layer moves.
export class EmailAdapter {
  /**
   * @param {{to:string, subject:string, html:string, text:string, from:string, headers?:object}} message
   * @returns {Promise<{provider_message_id:string}>} resolves on accept, rejects on failure
   */
  async send(message) { // eslint-disable-line no-unused-vars
    throw new Error('not implemented');
  }
}
