import { expect, test } from '@playwright/test';
import { API, consoleErrors, forbidExternalRequests, receivePrescription, signIn } from './helpers';

test('a pharmacist verifies and dispenses a prescription from CliniTrack, then gets Zebra labels', async ({ page, request }) => {
  const { externalId } = await receivePrescription(request);
  const errors = consoleErrors(page);
  const noExternal = forbidExternalRequests(page);
  await signIn(page, 'PHARMACIST');

  await page.goto('/dispensing');
  await expect(page.getByRole('heading', { name: 'Dispensing queue' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: externalId });
  await expect(row).toBeVisible();
  await row.getByRole('link').first().click();

  await expect(page.getByRole('heading', { name: /PAT-1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Run checks and verify' }).click();
  await expect(page.getByRole('heading', { name: 'Dispense', exact: true })).toBeVisible();

  await page.getByLabel('Quantity').fill('60');
  await page.getByRole('button', { name: 'Dispense', exact: true }).click();
  await expect(page.getByText(/^Dispensed\. Stock deduction and billing/)).toBeVisible();

  const dispensed = page.locator('.table-wrap').filter({ hasText: 'Batch' });
  await expect(dispensed.getByRole('row')).toHaveCount(3); // header + two batches (earliest expiry first, 40 + 20)
  await expect(page.getByRole('heading', { name: 'Zebra labels' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZPL file' }).click();
  const zpl = await (await download).path().then((p) => require('node:fs').readFileSync(p!, 'utf8') as string);
  expect(zpl).toContain('^XA');
  expect(zpl).toContain('Metformin');

  noExternal();
  expect(errors).toEqual([]);
});

test('where the facility allows it, a pharmacist records a consultant override of a hard stop', async ({ page, request }) => {
  const admin = { 'x-user-id': 'admin-1', 'x-user-roles': 'ADMINISTRATOR', 'x-facility-id': 'FAC-1' };
  expect((await request.put(`${API}/facilities/FAC-1/profile`, { headers: admin, data: { name: 'Riverside Clinic', allowHardStopOverride: true } })).ok()).toBe(true);

  // Ibuprofen with a gastric ulcer: a hard stop the prescriber's consultant already overrode at prescribing.
  const items = [{ ref: 'L1', hptCode: 'GE10403', atcCode: 'M01AE01', dose: 400, doseUnit: 'mg', frequency: 'TDS', frequencyPerDay: 3, route: 'ORAL', durationDays: 3, quantity: 9 }];
  const context = { ageMonths: 480, weightKg: 70, diagnoses: [{ system: 'ICD10', code: 'K25.9' }] };
  const check = await request.post(`${API}/safety/check`, { headers: { 'x-user-id': 'clinitrack', 'x-user-roles': 'SYSTEM', 'x-facility-id': 'FAC-1' }, data: { patientId: 'PAT-HS', facilityId: 'FAC-1', context, items: items.map(({ ref, hptCode, dose, doseUnit, frequencyPerDay, route }) => ({ ref, hptCode, dose, doseUnit, frequencyPerDay, route })) } });
  expect(check.ok()).toBe(true);
  const key = (await check.json()).consultantOverridable[0];
  const { externalId } = await receivePrescription(request, {
    patientId: 'PAT-HS',
    context,
    items,
    overrides: [{ key, reason: 'Short course with PPI cover, reviewed', authorisedBy: 'dr.consultant' }],
  });

  await signIn(page, 'PHARMACIST');
  await page.goto('/dispensing');
  await page.getByRole('row').filter({ hasText: externalId }).getByRole('link').first().click();
  await page.getByRole('button', { name: 'Run checks and verify' }).click();

  const verify = page.getByRole('button', { name: 'Verify with overrides' });
  await expect(page.getByText(/This facility lets a consultant authorise an override/)).toBeVisible();
  await expect(verify).toBeDisabled();
  await page.getByLabel(/Consultant who authorised overriding/).fill('dr.consultant');
  await page.getByLabel(/Clinical reason for overriding/).fill('Consultant confirmed by phone, PPI given');
  await verify.click();
  await expect(page.getByRole('heading', { name: 'Dispense', exact: true })).toBeVisible();
  await expect(page.getByText(/authorised by consultant dr\.consultant/).first()).toBeVisible();
});
