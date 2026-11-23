import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('an administrator sets the facility profile and removes medicine names from SMS', async ({ page }) => {
  await signIn(page, 'ADMINISTRATOR');
  await page.goto('/settings');
  await page.getByLabel('Facility name').fill('Riverside Clinic');
  await page.getByLabel('Phone for enquiries').fill('0711 000 111');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await expect(page.getByText(/messages name the medicine/)).toBeVisible();
  await expect(page.locator('.label-preview').first()).toContainText('Riverside Clinic');
  await page.getByRole('button', { name: 'Remove medicine names from all messages' }).click();
  await expect(page.getByText('No message names the medicine.')).toBeVisible();

  await page.getByRole('button', { name: 'Reset to default' }).first().click();
  await expect(page.getByText(/1 of 8 messages name the medicine/)).toBeVisible();
});

test('a pharmacist can read the settings but not change them', async ({ page }) => {
  await signIn(page, 'PHARMACIST');
  await page.goto('/settings');
  await expect(page.getByLabel('Facility name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save profile' })).toHaveCount(0);
});
