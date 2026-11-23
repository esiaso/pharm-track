import { Injectable, Logger } from '@nestjs/common';
import { AtSendError, atBaseUrl, atParseSend, atSendForm } from '../domain/africastalking';
import { callJson } from './http';

export interface SmsSendResult {
  providerMessageId: string;
}

/** Pluggable SMS gateway. Pick with SMS_PROVIDER (log | http | africastalking). */
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

/**
 * Africa's Talking (SMS_PROVIDER=africastalking). Uses AFRICASTALKING_USERNAME,
 * SMS_API_KEY and SMS_SENDER_ID; the username "sandbox" sends to the sandbox.
 */
@Injectable()
export class AfricasTalkingSmsProvider extends SmsProvider {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {
    super();
  }

  async send(to: string, body: string, _reference?: string): Promise<SmsSendResult> {
    const username = this.env.AFRICASTALKING_USERNAME ?? '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${atBaseUrl(username)}/version1/messaging`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { apiKey: this.env.SMS_API_KEY ?? '', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: atSendForm({ username, to, message: body, senderId: this.env.SMS_SENDER_ID || undefined }),
      });
    } catch (e) {
      throw new AtSendError(`Africa's Talking unreachable: ${(e as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      // 401: wrong key or username. Retrying will not help until the settings are fixed.
      throw new AtSendError(`Africa's Talking -> ${res.status}: ${text.slice(0, 200)}`, res.status >= 500 || res.status === 429);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AtSendError(`Africa's Talking sent an unreadable reply: ${text.slice(0, 200)}`, true);
    }
    return { providerMessageId: atParseSend(json as Parameters<typeof atParseSend>[0]) };
  }
}
