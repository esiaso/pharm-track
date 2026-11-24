import { APIRequestContext, expect, Page } from '@playwright/test';

export const API = 'http://localhost:3000/api/v1';
const SYSTEM = { 'x-user-id': 'clinitrack', 'x-user-roles': 'SYSTEM', 'x-facility-id': 'FAC-1' };

/** Signs in through the development session switcher's saved state. */
export async function signIn(page: Page, role: 'PHARMACIST' | 'ADMINISTRATOR' | 'PHARMACY_TECHNICIAN', userId = role === 'ADMINISTRATOR' ? 'admin-1' : 'pharm-1') {
  await page.addInitScript(
    ([r, u]) => localStorage.setItem('pharmtrack.session', JSON.stringify({ userId: u, role: r, roles: [r], facilityId: 'FAC-1', storeId: 'STORE-1', sso: false })),
    [role, userId] as const,
  );
}

/** Fails the test if the page loads anything from outside this machine. */
export function forbidExternalRequests(page: Page) {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(u.hostname)) external.push(r.url());
  });
  return () => expect(external, 'requests to other hosts').toEqual([]);
}

/** Collects console errors so a test can assert there were none. */
export function consoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Posts a signed prescription the way CliniTrack does and returns its dispense order id. */
export async function receivePrescription(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const res = await request.post(`${API}/prescriptions`, {
    headers: SYSTEM,
    data: {
      externalId: `CT-RX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      patientId: 'PAT-1',
      encounterId: 'ENC-1',
      prescriberId: 'dr.wanjiru',
      facilityId: 'FAC-1',
      storeId: 'STORE-1',
      signedAt: new Date().toISOString(),
      context: { ageMonths: 480, weightKg: 70, diagnoses: [{ system: 'ICD10', code: 'E11.9' }] },
      items: [{ ref: 'L1', hptCode: 'GE10002', atcCode: 'A10BA02', dose: 500, doseUnit: 'mg', frequency: 'BD', frequencyPerDay: 2, route: 'ORAL', durationDays: 30, quantity: 60, refills: 2 }],
      ...over,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { orderId: body.dispenseOrders[0].id as string, externalId: body.externalId as string };
}
