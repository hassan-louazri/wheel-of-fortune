import { expect, test } from '@playwright/test';
import { PARTICIPATION_KEY } from '../src/game/participation';
import { claimFixture, seedClaim, storedClaims } from './fixtures/claims';
import { participationFixture, seedOnFirstVisit, showVisualState, storedParticipation, testNow } from './fixtures/participation';

for (const status of ['instagram_required', 'ready', 'cooldown', 'pending_claim', 'completed'] as const) {
  test(`language switching and refresh retain ${status} participation`, async ({ page }) => {
    await page.clock.install({ time: testNow });
    await page.goto('/');
    const visual = { instagram_required: 'subscription', ready: 'wheel', cooldown: 'loss', pending_claim: 'win', completed: 'completed' }[status];
    await showVisualState(page, visual);
    await page.clock.pauseAt(testNow + 60000);
    if (status === 'pending_claim') await page.getByLabel('Votre adresse e-mail').fill('draft@example.com');
    const before = await storedParticipation(page);
    await page.getByLabel('Langue').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await storedParticipation(page)).toEqual(before);
    if (status === 'pending_claim') await expect(page.getByLabel('Your email address')).toHaveValue('draft@example.com');
    await page.reload();
    await expect(page.getByLabel('Language')).toHaveValue('en');
    expect(await storedParticipation(page)).toEqual(before);
  });
}

test('winning dialog traps keyboard focus, restores its opener, and keeps focus after confirmation', async ({ page }) => {
  await seedOnFirstVisit(page, participationFixture('pending_claim'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Récupérer mon cadeau' })).toBeEnabled();
  await page.keyboard.press('Escape');
  const opener = page.getByRole('button', { name: 'Afficher mon cadeau' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    // Native dialogs may hand focus to browser chrome at a boundary, never to the inert page.
    expect(await dialog.evaluate((node) => document.activeElement === document.body || node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await opener.press('Enter');
  await dialog.getByLabel('Votre adresse e-mail').fill('keyboard@example.com');
  await dialog.getByLabel('Votre adresse e-mail').press('Enter');
  await expect(dialog.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Terminer' })).toBeFocused();
});

test('an impossible persisted cooldown deadline fails closed without deleting the record', async ({ page }) => {
  const raw = JSON.stringify({ ...participationFixture('cooldown'), cooldownUntil: 0 });
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: PARTICIPATION_KEY, raw });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('données de participation non reconnues');
  await expect(page.locator('.spin-button')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), PARTICIPATION_KEY)).toBe(raw);
});

test('a completed visitor with no claim stays disabled and receives localized recovery guidance', async ({ page }) => {
  await seedOnFirstVisit(page, participationFixture('completed'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('enregistrement n’a pas été retrouvé');
  await expect(page.locator('.spin-button')).toBeDisabled();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('claim record could not be found');
  expect(await storedClaims(page)).toEqual([]);
  expect((await storedParticipation(page)).status).toBe('completed');
});

test('a retired prize snapshot is rendered as text and remains unchanged through actual claim submission', async ({ page }) => {
  const pending = participationFixture('pending_claim');
  if (pending.status !== 'pending_claim') throw new Error('fixture');
  const label = '<img src=x onerror=alert(1)> Café historique';
  const historical = { ...pending, outcome: { ...pending.outcome, segment: {
    ...pending.outcome.segment, id: 'retired-prize', label: { fr: label, en: 'Historic gift' },
  } } };
  await seedOnFirstVisit(page, historical);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  await expect(page.locator('.prize-name img')).toHaveCount(0);
  await page.getByLabel('Votre adresse e-mail').fill('snapshot@example.com');
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
  const rows = await storedClaims(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ prizeId: 'retired-prize', prizeName: label, participation: { outcome: historical.outcome } });
  await page.reload();
  expect(await storedClaims(page)).toEqual(rows);
});

test('a passive winning tab receives completion without submitting or duplicating the claim', async ({ page, context }) => {
  await seedOnFirstVisit(page, participationFixture('pending_claim'));
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('button', { name: 'Récupérer mon cadeau' })).toBeEnabled();
  await page.getByLabel('Votre adresse e-mail').fill('one@example.com');
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await expect(other.locator('.completed-notice')).toContainText('Merci d’avoir participé');
  await expect(other.locator('.spin-button')).toBeDisabled();
  const rows = await storedClaims(other);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.email).toBe('one@example.com');
});

test('CSV ignores pending outcomes and remains available when localStorage is corrupted', async ({ page }) => {
  await seedOnFirstVisit(page, participationFixture('pending_claim'));
  await page.goto('/');
  const modulePath = process.env.PLAYWRIGHT_DEV_SERVER === '1' ? '/src/claims/export.ts' : '/claims-export.js';
  const exportCsv = () => page.evaluate(async (path) => (await import(path) as typeof import('../src/claims/export')).exportClaimsCsv(), modulePath);
  expect((await exportCsv()).split('\r\n')).toHaveLength(2);
  const saved = claimFixture('committed@example.com');
  await seedClaim(page, saved);
  await page.evaluate((key) => localStorage.setItem(key, '{broken'), PARTICIPATION_KEY);
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  const csv = await exportCsv();
  expect(csv).toContain('committed@example.com');
  expect(csv.split('\r\n')).toHaveLength(3);
  expect(await storedClaims(page)).toEqual([saved]);
});

test('simultaneous ready tabs without Web Locks or BroadcastChannel select exactly one outcome', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined });
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
  });
  await seedOnFirstVisit(page);
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  for (const tab of [page, other]) await expect(tab.locator('.spin-button')).toBeEnabled();
  const counters = await Promise.all([page, other].map((tab) => tab.evaluateHandle(() => {
    const counter = { calls: 0 };
    Math.random = () => { counter.calls++; return 0.3; };
    return counter;
  })));
  await Promise.all([page, other].map((tab) => tab.locator('.spin-button').dispatchEvent('click')));
  for (const tab of [page, other]) await expect(tab.locator('.spin-button')).toBeDisabled();
  const calls = await Promise.all(counters.map((counter) => counter.evaluate((value) => value.calls)));
  expect(calls.reduce((sum, value) => sum + value, 0)).toBe(1);
  expect(await storedParticipation(other)).toEqual(await storedParticipation(page));
});
