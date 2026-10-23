import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createClaim } from '../../src/claims/claim';
import { gameConfig } from '../../src/config';
import { PARTICIPATION_KEY } from '../../src/game/participation';
import type { Participation } from '../../src/game/participation';

export const testNow = new Date('2026-10-23T12:00:00Z').getTime();
export function participationFixture(status: Participation['status'] = 'ready', now = testNow): Participation {
  const common = {
    version: 1 as const, visitorId: '00000000-0000-4000-8000-000000000001',
    instagramOpenedAt: status === 'instagram_required' ? null : now - 2000,
    instagramConfirmedAt: status === 'instagram_required' ? null : now - 1000, rotation: 0,
  };
  if (status === 'ready' || status === 'instagram_required') return { ...common, status };
  const loss = status === 'cooldown';
  const outcome = {
    id: '00000000-0000-4000-8000-000000000002', segment: gameConfig.segments[loss ? 0 : 1]!,
    index: loss ? 0 : 1, rotation: loss ? 2497.5 : 2452.5, startedAt: now, revealAt: status === 'spinning' ? now + 18000 : now, cooldownMs: 3600000,
  };
  if (status === 'cooldown') return { ...common, rotation: outcome.rotation, status, outcome, cooldownUntil: now + 3600000 };
  return { ...common, rotation: status === 'spinning' ? 0 : outcome.rotation, status, outcome };
}

export async function seedOnFirstVisit(page: Page, state = participationFixture()) {
  await page.addInitScript(({ key, state }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(state));
  }, { key: PARTICIPATION_KEY, state });
}
export async function storedParticipation(page: Page): Promise<Participation> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), PARTICIPATION_KEY);
}
export async function openInstagram(page: Page) {
  await page.context().route('https://instagram.com/**', (route) => route.fulfill({ body: 'Instagram test page' }));
  const link = page.getByRole('link', { name: /INSTAGRAM/, exact: false });
  await expect(link).toHaveAttribute('href', 'https://instagram.com/cfoco.france');
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.close();
  await expect(page.getByRole('dialog', { name: /Revenez|Come back/ })).toBeVisible();
}

export async function showVisualState(page: Page, name: string, language: 'fr' | 'en' = 'fr') {
  const { clearClaimsFixture, seedClaim } = await import('./claims');
  await clearClaimsFixture(page);
  const status = name === 'win' || name === 'confirmation' ? 'pending_claim'
    : name === 'loss' ? 'cooldown' : name === 'completed' ? 'completed'
      : ['subscription', 'reminder', 'language'].includes(name) ? 'instagram_required' : 'ready';
  const state = participationFixture(status);
  if (status === 'completed') await seedClaim(page, createClaim(state, 'visual@example.com', language, testNow + 60000));
  await page.evaluate(({ key, state, language }) => {
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('wheel-of-fortune.language', language);
  }, { key: PARTICIPATION_KEY, state, language });
  await page.goto('/');
  if (name === 'wheel' || name === 'rules') await expect(page.locator('.spin-button')).toBeEnabled();
  if (name === 'reminder') await openInstagram(page);
  if (name === 'rules') await page.getByRole('button', { name: language === 'fr' ? 'Règles du jeu' : 'Game rules', exact: true }).click();
  if (name === 'language') await page.getByRole('button', { name: language === 'fr' ? 'Traduction' : 'Translation options', exact: true }).click();
  if (name === 'confirmation') {
    await page.getByLabel(language === 'fr' ? 'Votre adresse e-mail' : 'Your email address').fill('preview@example.com');
    await page.getByRole('button', { name: language === 'fr' ? 'Récupérer mon cadeau' : 'Claim my gift' }).click();
    await expect(page.getByRole('heading', { name: language === 'fr' ? 'Votre demande est enregistrée' : 'Your claim is saved' })).toBeVisible();
  }
}
