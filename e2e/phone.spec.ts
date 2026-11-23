import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('on a phone the menu is a drawer and no screen scrolls sideways', async ({ page }) => {
  await signIn(page, 'ADMINISTRATOR');
  for (const path of ['/', '/dispensing', '/formulary', '/reports', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: /open menu/i }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Refills' }).click();
  await expect(page).toHaveURL(/\/refills$/);
});
