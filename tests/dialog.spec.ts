import { expect, test } from '@playwright/test';
import { openInstagram, showVisualState } from './fixtures/participation';

test('Instagram reminder stays open until acknowledged and then unlocks the wheel', async ({ page }) => {
  await page.goto('/');
  await openInstagram(page);
  const reminder = page.getByRole('dialog', { name: 'Revenez sur cette page' });
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Je suis abonné(e)' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tourner la roue 🎯' })).toBeEnabled();
});

test('all shared dialogs survive mounting and still dismiss with Escape', async ({ page }) => {
  await page.goto('/');
  for (const preview of ['reminder', 'win', 'rules', 'language']) {
    await showVisualState(page, preview);
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Fermer', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
