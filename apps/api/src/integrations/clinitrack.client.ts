import { Injectable } from '@nestjs/common';
import { callJson } from './http';

/**
 * Client for CliniTrack. PharmTrack pushes events (billing lines, allergy
 * updates, prescription acknowledgements, price list) to one endpoint.
 * Contract: docs/api/clinitrack-contract.md.
 */
export abstract class ClinitrackClient {
  abstract deliverEvent(type: string, payload: unknown, idempotencyKey: string): Promise<{ reference?: string } | void>;
}

@Injectable()
export class HttpClinitrackClient extends ClinitrackClient {
  private readonly base = process.env.CLINITRACK_BASE_URL ?? 'http://localhost:4000/api/v1';
  private readonly token = process.env.CLINITRACK_TOKEN;

  deliverEvent(type: string, payload: unknown, idempotencyKey: string) {
    return callJson<{ reference?: string }>(this.base, 'POST', '/integrations/pharmtrack/events', {
      idempotencyKey,
      token: this.token,
      body: { type, version: 1, occurredAt: new Date().toISOString(), idempotencyKey, payload },
    });
  }
}
