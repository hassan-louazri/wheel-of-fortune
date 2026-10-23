import { devices, expect, test } from '@playwright/test';
import { LANGUAGE_STORAGE_KEY } from '../src/i18n/language';

test('starts in French even when the browser prefers English', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
  await expect(page.getByLabel('Langue')).toHaveValue('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page).toHaveTitle('La roue de la fortune');
});

test('persists both language choices across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Langue').selectOption('en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
  await expect(page.getByLabel('Language')).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Wheel of Fortune');
  await page.getByLabel('Language').selectOption('fr');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
});

test('falls back to French for an invalid saved preference', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'es'), LANGUAGE_STORAGE_KEY);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
});

test('still opens and switches language when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
});

for (const { width, height, heading } of [
  { width: 768, height: 1024, heading: 'Bienvenue !' },
  { width: 769, height: 1024, heading: 'Notre jeu fonctionne uniquement sur téléphone et tablette.' },
  { width: 1440, height: 900, heading: 'Notre jeu fonctionne uniquement sur téléphone et tablette.' },
  { width: 844, height: 390, heading: 'Notre jeu fonctionne uniquement sur téléphone et tablette.' },
  { width: 768, height: 600, heading: 'Tournez votre écran' },
  { width: 600, height: 600, heading: 'Bienvenue !' },
]) {
  test(`gates a ${width} × ${height} viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (heading !== 'Bienvenue !') await expect(page.locator('#landing-title')).toHaveCount(0);
  });
}

test('updates restrictions after resizing and translates both messages', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Langue').selectOption('en');
  await page.setViewportSize({ width: 700, height: 390 });
  await expect(page.getByRole('heading', { name: 'Rotate your screen' })).toBeVisible();
  await expect(page.locator('#landing-title')).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole('heading', { name: 'Our game works only on phones and tablets.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
});

test('supports mobile emulation with the correct CSS viewport', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await page.setViewportSize({ width: 700, height: 390 });
    await expect(page.getByRole('heading', { name: 'Tournez votre écran' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('fits a small phone without horizontal overflow or runtime errors', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenue !' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
