import { expect, test } from '@playwright/test';
import { consoleErrors, forbidExternalRequests, receivePrescription, signIn } from './helpers';

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
