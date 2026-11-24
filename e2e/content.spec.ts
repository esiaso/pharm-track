import { expect, test } from '@playwright/test';
import { consoleErrors, signIn } from './helpers';

test('an administrator loads the PPB HPT list from the FHIR CodeSystem JSON', async ({ page }) => {
  const errors = consoleErrors(page);
  await signIn(page, 'ADMINISTRATOR');
  await page.goto('/content');
  await page.getByRole('tab', { name: 'Code sets' }).click();
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Load a code list release' }) });
  await card.getByLabel('Code list').selectOption('hpt');
  await card.getByRole('textbox', { name: 'Release' }).fill('PPB-HPT-E2E');
  const json = {
    resourceType: 'CodeSystem',
    id: 'HPT',
    concept: [
      { code: 'Catalog', display: 'Catalog', active: true },
      { code: 'AC10001', display: 'Metformin', active: true },
      { code: 'GE10002', display: 'Metformin 500 mg Oral Tablet', active: true },
      { code: 'PH100', display: 'Medistatin 100000 mcg Oral Suspension', active: true },
    ],
  };
  await card.locator('#codes-file').setInputFiles({ name: 'hpt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await card.getByRole('button', { name: 'Check file' }).click();
  const result = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'What this file would change' }) }).last();
  await expect(result).toContainText('2 rows');
  await expect(result).toContainText('2 skipped');
  await card.getByRole('button', { name: 'Load PPB-HPT-E2E' }).click();
  await expect(page.getByText('Loaded. The import is recorded below.')).toBeVisible();
  expect(errors).toEqual([]);
});
