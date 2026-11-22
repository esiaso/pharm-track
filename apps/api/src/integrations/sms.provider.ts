import { Injectable, Logger } from '@nestjs/common';
import { callJson } from './http';

export interface SmsSendResult {
  providerMessageId: string;
}

/** Pluggable SMS gateway. Pick with SMS_PROVIDER (log | http). */
export abstract class SmsProvider {
  abstract send(toE164: string, body: string, reference: string): Promise<SmsSendResult>;
}

/** Development provider: logs instead of sending. */
@Injectable()
export class LogSmsProvider extends SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(to: string, body: string, reference: string): Promise<SmsSendResult> {
    this.logger.log(`[dev] SMS to ${to.slice(0, 7)}***: ${body}`);
    return { providerMessageId: `log-${reference}` };
  }
}

/**
 * Generic HTTP gateway adapter. Kenyan aggregators (for example Africa's Talking
 * or a SynergyOne messaging service) differ in payload shape, so this posts a
 * neutral body: { to, message, senderId, reference }. Adapt here per provider.
 */
@Injectable()
export class HttpSmsProvider extends SmsProvider {
  private readonly url = process.env.SMS_API_URL ?? '';
  private readonly key = process.env.SMS_API_KEY;
  private readonly senderId = process.env.SMS_SENDER_ID;

  async send(to: string, body: string, reference: string): Promise<SmsSendResult> {
    const res = await callJson<{ messageId?: string; id?: string }>(this.url, 'POST', '', {
      idempotencyKey: reference,
      token: this.key,
      body: { to, message: body, senderId: this.senderId, reference },
    });
    return { providerMessageId: res?.messageId ?? res?.id ?? reference };
  }
}
