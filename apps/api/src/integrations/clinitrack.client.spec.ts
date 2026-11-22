import { contractErrors } from '../../test/contracts';
import { HttpClinitrackClient } from './clinitrack.client';

describe('HttpClinitrackClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends the published envelope with the Idempotency-Key header, and returns the billing reference', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ reference: 'INV-1' }), { status: 200 });
    }) as typeof fetch;
    const client = new HttpClinitrackClient();
    const out = await client.deliverEvent('prescription.accepted', { prescriptionId: 'x' }, 'key-1');
    expect(out).toEqual({ reference: 'INV-1' });
    expect(calls[0]!.url).toMatch(/\/integrations\/pharmtrack\/events$/);
    expect((calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('key-1');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(contractErrors('envelope', body)).toEqual([]);
  });

  it('marks 4xx as not retryable and 5xx as retryable', async () => {
    const client = new HttpClinitrackClient();
    global.fetch = (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch;
    await expect(client.deliverEvent('t', {}, 'k')).rejects.toMatchObject({ retryable: false, status: 400 });
    global.fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(client.deliverEvent('t', {}, 'k')).rejects.toMatchObject({ retryable: true, status: 503 });
  });
});
