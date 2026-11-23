import { webhookTokenOk } from '../common/auth';
import { AfricasTalkingSmsProvider } from '../integrations/sms.provider';
import { AtSendError, atBaseUrl, atDeliveryStatus, atParseSend, atSendForm } from './africastalking';

describe("Africa's Talking", () => {
  it('builds the send form and picks sandbox or production', () => {
    expect(atSendForm({ username: 'clinic', to: '+254711000111', message: 'Hi', senderId: 'SYNERGY' }).toString()).toBe('username=clinic&to=%2B254711000111&message=Hi&from=SYNERGY');
    expect(atSendForm({ username: 'clinic', to: '+254711000111', message: 'Hi' }).has('from')).toBe(false);
    expect(atBaseUrl('sandbox')).toBe('https://api.sandbox.africastalking.com');
    expect(atBaseUrl('clinic')).toBe('https://api.africastalking.com');
  });

  it('reads the message id, and tells permanent refusals from ones worth retrying', () => {
    expect(atParseSend({ SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_1' }] } })).toBe('ATXid_1');
    const refused = (code: number, status: string) => {
      try {
        atParseSend({ SMSMessageData: { Recipients: [{ statusCode: code, status }] } });
      } catch (e) {
        return e as AtSendError;
      }
      throw new Error('expected a refusal');
    };
    expect(refused(403, 'InvalidPhoneNumber').retryable).toBe(false);
    expect(refused(406, 'UserInBlacklist').retryable).toBe(false);
    expect(refused(405, 'InsufficientBalance').retryable).toBe(true);
    expect(refused(500, 'InternalServerError').retryable).toBe(true);
    expect(() => atParseSend({ SMSMessageData: { Message: 'Sent to 0/1', Recipients: [] } })).toThrow(/no recipient/);
  });

  it('maps delivery reports', () => {
    expect(atDeliveryStatus('Success')).toBe('DELIVERED');
    for (const s of ['Failed', 'Rejected', 'AbsentSubscriber', 'Expired']) expect(atDeliveryStatus(s)).toBe('FAILED');
    for (const s of ['Sent', 'Submitted', 'Buffered', undefined]) expect(atDeliveryStatus(s)).toBeNull();
  });

  describe('provider', () => {
    const env = { AFRICASTALKING_USERNAME: 'sandbox', SMS_API_KEY: 'key-1', SMS_SENDER_ID: 'SYNERGY' };
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });
    const stub = (status: number, body: unknown) => {
      const calls: { url: string; init: RequestInit }[] = [];
      global.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      }) as typeof fetch;
      return calls;
    };

    it('posts the form with the API key and returns the message id', async () => {
      const calls = stub(201, { SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_9', number: '+254711000111' }] } });
      const res = await new AfricasTalkingSmsProvider(env).send('+254711000111', 'Hello', 'ref-1');
      expect(res.providerMessageId).toBe('ATXid_9');
      expect(calls[0].url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
      expect((calls[0].init.headers as Record<string, string>).apiKey).toBe('key-1');
      expect(String(calls[0].init.body)).toBe('username=sandbox&to=%2B254711000111&message=Hello&from=SYNERGY');
    });

    it('treats a wrong key as permanent and a gateway error as worth retrying', async () => {
      stub(401, 'The supplied authentication is invalid');
      await expect(new AfricasTalkingSmsProvider(env).send('+254711000111', 'Hello', 'r')).rejects.toMatchObject({ retryable: false });
      stub(503, 'busy');
      await expect(new AfricasTalkingSmsProvider(env).send('+254711000111', 'Hello', 'r')).rejects.toMatchObject({ retryable: true });
    });
  });

  it('checks the webhook token', () => {
    const secret = 'a-long-webhook-secret';
    expect(webhookTokenOk(secret, secret)).toBe(true);
    expect(webhookTokenOk('wrong', secret)).toBe(false);
    expect(webhookTokenOk(undefined, secret)).toBe(false);
    expect(webhookTokenOk('short', 'short')).toBe(false); // secrets under 16 characters are refused
  });
});
