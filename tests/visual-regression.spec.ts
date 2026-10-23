import { expect, test } from '@playwright/test';
import { gameConfig } from '../src/config';
import { showVisualState, storedParticipation, testNow } from './fixtures/participation';

for (const [width, height] of [[360, 800], [390, 844], [430, 932]] as const) {
  test(`visual regression at ${width} × ${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.clock.install({ time: testNow });
    await page.goto('/');
    await page.clock.pauseAt(testNow + 60000);
    for (const state of ['subscription', 'wheel', 'animation', 'win', 'invalid-email', 'confirmation', 'loss', 'completed', 'rules']) {
      await showVisualState(page, state === 'animation' ? 'wheel' : state === 'invalid-email' ? 'win' : state);
      if (state === 'animation') {
        await page.evaluate(() => {
          Math.random = () => 0.3;
          // Screenshot frames start with the spin, independent of the native frame phase.
          window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);
          window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
        });
        await page.locator('.spin-button').click();
        await expect.poll(async () => (await storedParticipation(page)).status).toBe('spinning');
        // Advance every frame so the screenshot has a reproducible mid-animation angle.
        await page.clock.runFor(gameConfig.spin.durationMs / 4);
        await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(153.28125 180 185)');
      }
      if (state === 'invalid-email') {
        await page.getByLabel('Votre adresse e-mail').fill('invalid');
        await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('img').evaluateAll((images) => images.every((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true);
      await expect(page).toHaveScreenshot(`${width}-${height}-${state}.png`, { maxDiffPixels: 0, threshold: 0 });
      if (state === 'win' || state === 'invalid-email') {
        const submit = page.getByRole('button', { name: 'Récupérer mon cadeau' });
        await submit.scrollIntoViewIfNeeded();
        // Native scroll geometry can leave a fraction of a CSS pixel outside the intersection.
        await expect(submit).toBeInViewport({ ratio: 0.999 });
      }
      if (state === 'loss') {
        await page.locator('time').scrollIntoViewIfNeeded();
        await expect(page.locator('time')).toBeInViewport();
        await expect(page).toHaveScreenshot(`${width}-${height}-loss-countdown.png`, { maxDiffPixels: 0, threshold: 0 });
      }
    }
    expect(errors).toEqual([]);
  });
}

test('desktop and landscape restrictions preserve the pending prize', async ({ page }) => {
  await page.clock.install({ time: testNow });
  await page.goto('/');
  await page.clock.pauseAt(testNow + 60000);
  await showVisualState(page, 'win');
  const before = await storedParticipation(page);
  for (const [width, height, name] of [[1440, 900, 'desktop'], [600, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: name === 'desktop'
      ? 'Notre jeu fonctionne uniquement sur téléphone et tablette.' : 'Tournez votre écran' })).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}-${width}-${height}.png`, { maxDiffPixels: 0, threshold: 0 });
    expect(await storedParticipation(page)).toEqual(before);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
});
