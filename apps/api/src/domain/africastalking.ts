/**
 * Africa's Talking SMS: request building and response parsing, kept pure so
 * they can be tested without the network.
 *
 * Send: POST {base}/version1/messaging, form-encoded username, to, message and
 * optional from (the approved sender id), with the apiKey header.
 * Delivery reports: Africa's Talking POSTs id, status and failureReason to the
 * callback URL set in its dashboard.
 */

export const AT_PRODUCTION_URL = 'https://api.africastalking.com';
export const AT_SANDBOX_URL = 'https://api.sandbox.africastalking.com';

/** The sandbox account is always called "sandbox". */
export const atBaseUrl = (username: string) => (username === 'sandbox' ? AT_SANDBOX_URL : AT_PRODUCTION_URL);

export function atSendForm(p: { username: string; to: string; message: string; senderId?: string }): URLSearchParams {
  const f = new URLSearchParams({ username: p.username, to: p.to, message: p.message });
  if (p.senderId) f.set('from', p.senderId);
  return f;
}

export class AtSendError extends Error {
  constructor(
    message: string,
    /** False when sending again cannot help (bad number, blacklisted, sender id not approved). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Status codes Africa's Talking returns per recipient. 100 to 102 mean accepted. */
const RETRYABLE_CODES = new Set([405, 500, 501, 502]); // insufficient balance, gateway and internal errors

type AtResponse = { SMSMessageData?: { Message?: string; Recipients?: { statusCode?: number; status?: string; messageId?: string; number?: string }[] } };

/** Returns the message id for the single recipient, or throws AtSendError. */
export function atParseSend(res: AtResponse): string {
  const r = res?.SMSMessageData?.Recipients?.[0];
  if (!r) throw new AtSendError(`Africa's Talking accepted no recipient: ${res?.SMSMessageData?.Message ?? 'empty response'}`, true);
  const code = Number(r.statusCode);
  if (code >= 100 && code <= 102 && r.messageId) return r.messageId;
  throw new AtSendError(`Africa's Talking refused the message: ${r.status ?? 'unknown'} (${code})`, RETRYABLE_CODES.has(code));
}

/**
 * Maps a delivery-report status to ours. Sent, Submitted and Buffered are
 * steps on the way and change nothing.
 */
export function atDeliveryStatus(status: string | undefined): 'DELIVERED' | 'FAILED' | null {
  switch (status) {
    case 'Success':
      return 'DELIVERED';
    case 'Failed':
    case 'Rejected':
    case 'AbsentSubscriber':
    case 'Expired':
      return 'FAILED';
    default:
      return null;
  }
}
