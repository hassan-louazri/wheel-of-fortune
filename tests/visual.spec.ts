import { expect, test } from '@playwright/test';
import { gameConfig } from '../src/config';
import { openInstagram, seedOnFirstVisit, showVisualState, storedParticipation } from './fixtures/participation';

test('subscription, selected win, email validation, confirmation and persistent completed participation journey', async ({ page, baseURL }) => {
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  await page.addInitScript(() => { Math.random = () => 0.3; });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Je suis abonné(e)', exact: true })).toBeDisabled();
  await openInstagram(page);
  const reminder = page.getByRole('dialog', { name: 'Revenez sur cette page' });
  await expect(reminder).toBeVisible();
  await reminder.getByRole('button', { name: 'Je suis abonné(e)' }).click();
  const wheel = page.getByRole('img', { name: 'Roue de la fortune et ses cadeaux' });
  await expect(wheel).toBeVisible();
  await expect(wheel.locator('text')).toHaveCount(gameConfig.segments.length);
  await expect(wheel.locator('text title')).toHaveText(gameConfig.segments.map((segment) => segment.label.fr));
  await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
  await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
  await expect.poll(async () => (await storedParticipation(page)).status).toBe('spinning');
  await page.clock.fastForward(gameConfig.spin.durationMs + 16);
  await page.clock.fastForward(gameConfig.spin.revealDelayMs);
  const winner = page.getByRole('dialog', { name: /Félicitations/ });
  await expect(winner).toBeVisible();
  await expect(winner.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  await winner.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(winner).toBeVisible();
  await winner.getByLabel('Votre adresse e-mail').fill('invalid');
  await winner.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(winner).toBeVisible();
  await winner.getByLabel('Votre adresse e-mail').fill('preview@example.com');
  await winner.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
  await expect(page.getByLabel('Votre adresse e-mail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByRole('button', { name: 'Vous avez déjà joué' })).toBeDisabled();
  await expect(page.getByRole('img', { name: /Roue de la fortune désactivée/ })).toBeVisible();
  expect(requests).toEqual([]);
  expect((await storedParticipation(page)).status).toBe('completed');
  expect(await page.evaluate(() => localStorage.getItem('wheel-of-fortune.participation'))).not.toContain('preview@example.com');
  await page.reload();
  await expect(page.getByText('Merci d’avoir participé ! Vous avez déjà tenté votre chance.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('rules and language dialogs support keyboard focus, Escape and translated copy', async ({ page }) => {
  await seedOnFirstVisit(page);
  await page.goto('/');
  const rules = page.getByRole('button', { name: 'Règles du jeu', exact: true });
  await rules.click();
  const dialog = page.getByRole('dialog', { name: 'Règles du jeu' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'J’ai compris' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(rules).toBeFocused();
  await page.getByRole('button', { name: 'Traduction', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByLabel('Language')).toHaveValue('en');
  await expect(page.getByRole('button', { name: 'Spin the wheel 🎯' })).toBeVisible();
  await page.getByRole('button', { name: 'Game rules', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Game rules' })).toBeVisible();
});

test('losing state has a live countdown and translated artwork', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
  await showVisualState(page, 'loss');
  await expect(page.getByRole('heading', { name: 'Pas cette fois, Courage !' })).toBeVisible();
  await expect(page.getByLabel('0 heures, 59 minutes et 0 secondes')).toHaveText('00 : 59 : 00');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Not this time. Keep your spirits up!' })).toBeVisible();
  await expect(page.getByText('Sorry, you lost!', { exact: true })).toBeVisible();
});

test('pending claim dialogs respect the viewport gate and return after resize', async ({ page }) => {
  await page.goto('/');
  await showVisualState(page, 'win');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 769, height: 1024 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notre jeu fonctionne uniquement sur téléphone et tablette.' })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 400 });
  await expect(page.getByRole('heading', { name: 'Tournez votre écran' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog')).toBeVisible();
});

for (const width of [360, 390, 430]) {
  test(`all visual states at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
    await page.goto('/');
    await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
    for (const state of ['subscription', 'reminder', 'wheel', 'win', 'confirmation', 'loss', 'rules', 'completed', 'language']) {
      await showVisualState(page, state);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('body')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator('img').evaluateAll((images) => images.every((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true);
      if (state === 'win') {
        const button = (await page.getByRole('button', { name: 'Récupérer mon cadeau' }).boundingBox())!;
        const dialog = (await page.getByRole('dialog').boundingBox())!;
        expect(button.y + button.height).toBeLessThanOrEqual(dialog.y + dialog.height);
      }
      const screenshot = testInfo.outputPath(`${width}-${state}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      await testInfo.attach(`${width}-${state}`, { path: screenshot, contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
}

test('English screens fit a short phone, including scrollable dialogs and form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
  await page.getByLabel('Langue').selectOption('en');
  for (const state of ['subscription', 'reminder', 'wheel', 'win', 'confirmation', 'loss', 'rules', 'completed', 'language']) {
    await showVisualState(page, state, 'en');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`320-en-${state}.png`), fullPage: true, animations: 'disabled' });
    if (state === 'win') {
      await page.getByLabel('Your email address').fill('preview@example.com');
      await page.getByRole('button', { name: 'Claim my gift' }).click();
      await expect(page.getByRole('heading', { name: 'Your claim is saved' })).toBeVisible();
    }
    const close = page.getByRole('button', { name: 'Close', exact: true });
    if (await close.count()) await close.click();
  }
});
