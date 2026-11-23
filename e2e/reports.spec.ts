import { expect, test } from '@playwright/test';
import { API, consoleErrors, receivePrescription, signIn } from './helpers';

const pharmacist = (id: string) => ({ 'x-user-id': id, 'x-user-roles': 'PHARMACIST', 'x-facility-id': 'FAC-1' });

test('a pharmacist reads the controlled-drug register and downloads it', async ({ page, request }) => {
  // Morphine dispensed by one pharmacist and witnessed by another.
  const { orderId, externalId } = await receivePrescription(request, {
    patientId: 'PAT-CD',
    items: [{ ref: 'L1', hptCode: 'SAMPLE-HPT-0006', atcCode: 'N02AA01', dose: 10, doseUnit: 'mg', frequency: 'Q4H', frequencyPerDay: 6, route: 'ORAL', durationDays: 2, quantity: 12 }],
  });
  const order = await (await request.get(`${API}/dispensing/orders/${orderId}`, { headers: pharmacist('pharm-1') })).json();
  const itemId = order.prescription?.items?.[0]?.id ?? order.items?.[0]?.id;
  expect((await request.post(`${API}/dispensing/orders/${orderId}/verify`, { headers: pharmacist('pharm-1'), data: {} })).ok()).toBe(true);
  const done = await request.post(`${API}/dispensing/orders/${orderId}/dispense`, {
    headers: pharmacist('pharm-1'),
    data: { lines: [{ prescriptionItemId: itemId, quantity: 12, witnessedBy: 'pharm-2' }] },
  });
  expect(done.ok(), await done.text()).toBe(true);

  const errors = consoleErrors(page);
  await signIn(page, 'PHARMACIST');
  await page.goto('/reports#controlled');
  const entries = page.getByRole('table', { name: 'Register entries' });
  const row = entries.getByRole('row').filter({ hasText: externalId });
  await expect(row).toContainText('PAT-CD');
  await expect(row).toContainText('pharm-2');
  await expect(page.getByRole('table', { name: 'Totals by drug' })).toContainText(/Morphine/i);

  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(file.suggestedFilename()).toBe('controlled-drug-register.csv');
  const csv = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(csv).toContain('witnessed_by');
  expect(csv).toContain(externalId);
  expect(errors).toEqual([]);
});
