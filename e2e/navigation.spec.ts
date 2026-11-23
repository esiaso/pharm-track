import { expect, test } from '@playwright/test';
import { consoleErrors, forbidExternalRequests, signIn } from './helpers';

const SCREENS: [string, RegExp][] = [
  ['/', /Overview/],
  ['/dispensing', /Dispensing queue/],
  ['/refills', /Refills/],
  ['/patients', /Patients/],
  ['/formulary', /Formulary/],
  ['/reports', /Reports/],
  ['/content', /Clinical content/],
  ['/integrations', /Integrations/],
  ['/privacy', /Data protection/],
  ['/settings', /Settings/],
];

test('every screen loads for an administrator, with nothing loaded from outside', async ({ page }) => {
  const errors = consoleErrors(page);
  const noExternal = forbidExternalRequests(page);
  await signIn(page, 'ADMINISTRATOR');
  for (const [path, heading] of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toHaveText(heading);
  }
  noExternal();
  expect(errors).toEqual([]);
});

test('the menu follows the role', async ({ page }) => {
  await signIn(page, 'PHARMACY_TECHNICIAN', 'tech-1');
  await page.goto('/');
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Dispensing' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Data protection' })).toHaveCount(0);
});

test('Ctrl+K search jumps to a screen', async ({ page }) => {
  await signIn(page, 'PHARMACIST');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('refil');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/refills$/);
});

test('dark mode is remembered', async ({ page }) => {
  await signIn(page, 'PHARMACIST');
  await page.goto('/');
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByRole('button', { name: /theme|dark|light/i }).first().click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after!);
});
