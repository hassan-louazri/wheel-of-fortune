import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gameConfig } from '../src/config';
import { PARTICIPATION_KEY } from '../src/game/participation';
import { openInstagram, participationFixture, seedOnFirstVisit, storedParticipation, testNow } from './fixtures/participation';

async function ready(page: Page, sample = 0.3) {
  await page.clock.install({ time: testNow });
  await seedOnFirstVisit(page);
  await page.goto('/');
  await page.clock.pauseAt(testNow + 60000);
  await page.evaluate((sample) => { Math.random = () => sample; }, sample);
}
async function spin(page: Page) {
  await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
  await expect(page.locator('.spin-button')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(async () => (await storedParticipation(page)).status).toBe('spinning');
}
async function reveal(page: Page) {
  await page.clock.fastForward(gameConfig.spin.durationMs + 16);
  await page.clock.fastForward(gameConfig.spin.revealDelayMs);
}

test('first visit requires opening the hardcoded Instagram link, then persists confirmation and visitor UUID', async ({ page }) => {
  await page.goto('/?preview=wheel');
  const confirmation = page.getByRole('button', { name: 'Je suis abonné(e)', exact: true });
  await expect(confirmation).toBeDisabled();
  const first = await storedParticipation(page);
  expect(first.status).toBe('instagram_required');
  expect(first.visitorId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  await openInstagram(page);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Je suis abonné(e)' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(confirmation).toBeEnabled();
  await confirmation.click();
  await expect(page.locator('.spin-button')).toBeEnabled();
  await page.reload();
  await expect(page.locator('.spin-button')).toBeEnabled();
  expect((await storedParticipation(page)).visitorId).toBe(first.visitorId);
  expect((await storedParticipation(page)).instagramConfirmedAt).not.toBeNull();
});

test('outcome is persisted before any frame, loss countdown survives refresh and expiration permits a continuous next spin', async ({ page }) => {
  await ready(page, 0.125);
  await spin(page);
  const selected = await storedParticipation(page);
  expect(selected).toMatchObject({ status: 'spinning', outcome: { segment: { id: 'loss-1' }, rotation: 2497.5 } });
  await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(0 180 185)');
  await reveal(page);
  await expect(page.locator('time')).toHaveText('01 : 00 : 00');
  const lost = await storedParticipation(page);
  if (lost.status !== 'cooldown') throw new Error('Expected cooldown');
  expect(lost.cooldownUntil).toBe(lost.outcome.revealAt + lost.outcome.cooldownMs);
  await page.clock.fastForward(120000);
  await expect(page.locator('time')).toHaveText('00 : 58 : 00');
  await page.reload();
  await expect(page.locator('time')).toHaveText('00 : 58 : 00');
  expect((await storedParticipation(page))).toEqual(lost);
  const remaining = lost.cooldownUntil - await page.evaluate(() => Date.now());
  await page.clock.fastForward(remaining - 1);
  await expect(page.locator('.spin-button')).toHaveCount(0);
  await page.clock.fastForward(1);
  await expect(page.locator('.spin-button')).toBeEnabled();
  await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(2497.5 180 185)');
  await page.evaluate(() => { Math.random = () => 0.3; });
  await spin(page);
  await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(2497.5 180 185)');
  const next = await storedParticipation(page);
  expect(next).toMatchObject({ status: 'spinning', outcome: { segment: { id: 'dessert' }, rotation: 4972.5 } });
  await reveal(page);
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
});

for (const [kind, sample] of [['prize', 0.3], ['loss', 0.125]] as const) {
  test(`interrupted ${kind} spin recovers immediately and never samples another outcome`, async ({ page }) => {
    await ready(page, sample);
    await spin(page);
    await page.clock.fastForward(1000);
    const before = await storedParticipation(page);
    await page.addInitScript(() => { Math.random = () => 0.99; });
    await page.reload();
    await expect.poll(async () => (await storedParticipation(page)).status).toBe(kind === 'prize' ? 'pending_claim' : 'cooldown');
    const after = await storedParticipation(page);
    expect('outcome' in after && after.outcome).toEqual('outcome' in before && before.outcome);
    if (kind === 'prize') {
      await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
      await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(2452.5 180 185)');
      await page.keyboard.press('Escape');
      await expect(page.locator('.spin-button')).toBeDisabled();
      await page.getByRole('button', { name: 'Afficher mon cadeau' }).click();
      await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
    } else {
      await expect(page.locator('time')).toHaveText('01 : 00 : 00');
      await page.clock.fastForward(60000);
      await page.reload();
      await expect(page.locator('time')).toHaveText('00 : 59 : 00');
    }
  });
}

test('pending claims survive a new browser context with restored origin storage, and never permit another spin', async ({ page, browser }) => {
  await ready(page);
  await spin(page);
  await reveal(page);
  const before = await storedParticipation(page);
  const storageState = await page.context().storageState();
  const returning = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
  try {
    const next = await returning.newPage();
    await next.goto('/');
    await expect(next.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
    expect(await storedParticipation(next)).toEqual(before);
    await next.keyboard.press('Escape');
    await expect(next.locator('.spin-button')).toBeDisabled();
    await next.locator('.spin-button').dispatchEvent('click');
    expect(await storedParticipation(next)).toEqual(before);
  } finally { await returning.close(); }
});

test('a tab opened during animation observes the live spin, blocks repeated actions and receives the matching result', async ({ page, context }) => {
  await ready(page);
  await spin(page);
  const before = await storedParticipation(page);
  const other = await context.newPage();
  await other.clock.install({ time: testNow + 60000 });
  await other.goto('/');
  await other.clock.pauseAt(testNow + 120000);
  await expect(other.locator('.spin-button')).toBeDisabled();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await other.locator('.spin-button').dispatchEvent('click');
  expect(await storedParticipation(other)).toEqual(before);
  await reveal(page);
  await expect(other.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  expect(await storedParticipation(other)).toEqual(await storedParticipation(page));
});

test('simultaneous attempts in two ready tabs select only once', async ({ page, context }) => {
  await ready(page);
  const other = await context.newPage();
  await other.clock.install({ time: testNow });
  await other.goto('/');
  await other.clock.pauseAt(testNow + 60000);
  const counters = await Promise.all([page, other].map((tab) => tab.evaluateHandle(() => {
    const counter = { calls: 0 };
    Math.random = () => { counter.calls++; return 0.3; };
    return counter;
  })));
  await Promise.all([page, other].map((tab) => tab.locator('.spin-button').dispatchEvent('click')));
  await expect(page.locator('.spin-button')).toBeDisabled();
  await expect(other.locator('.spin-button')).toBeDisabled();
  const calls = await Promise.all(counters.map((counter) => counter.evaluate((value) => value.calls)));
  expect(calls.reduce((total, value) => total + value, 0)).toBe(1);
  const owner = calls[0] === 1 ? page : other;
  const observer = owner === page ? other : page;
  const selected = await storedParticipation(owner);
  await owner.close();
  await expect(observer.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  const recovered = await storedParticipation(observer);
  expect('outcome' in recovered && recovered.outcome).toEqual('outcome' in selected && selected.outcome);
});

test('Instagram confirmation and cooldown expiration synchronize across existing tabs', async ({ page, context }) => {
  await page.clock.install({ time: testNow });
  await page.goto('/');
  await page.clock.pauseAt(testNow + 60000);
  const other = await context.newPage();
  await other.clock.install({ time: testNow });
  await other.goto('/');
  await other.clock.pauseAt(testNow + 60000);
  expect((await storedParticipation(page)).visitorId).toBe((await storedParticipation(other)).visitorId);
  await openInstagram(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Je suis abonné(e)' }).click();
  await expect(other.locator('.spin-button')).toBeEnabled();
  await page.evaluate(() => { Math.random = () => 0.125; });
  await spin(page);
  await reveal(page);
  await expect(other.getByRole('heading', { name: 'Pas cette fois, Courage !' })).toBeVisible();
  await page.clock.fastForward(3600000);
  await expect(page.locator('.spin-button')).toBeEnabled();
  await expect(other.locator('.spin-button')).toBeEnabled();
});

for (const fallbackLocks of [false, true]) {
  test(`storage events synchronize tabs with BroadcastChannel disabled${fallbackLocks ? ' and Web Locks unavailable' : ''}`, async ({ page, context }) => {
    await context.addInitScript((fallbackLocks) => {
      Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
      if (fallbackLocks) Object.defineProperty(navigator, 'locks', { value: undefined });
    }, fallbackLocks);
    await ready(page);
    const other = await context.newPage();
    await other.clock.install({ time: testNow });
    await other.goto('/');
    await other.clock.pauseAt(testNow + 60000);
    await spin(page);
    await expect(other.locator('.spin-button')).toBeDisabled();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await reveal(page);
    await expect(other.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
    expect(await storedParticipation(other)).toEqual(await storedParticipation(page));
  });
}

test('stored prize snapshots remain claimable after their segment is removed or renamed in configuration', async ({ page }) => {
  const pending = participationFixture('pending_claim');
  if (pending.status !== 'pending_claim') throw new Error('fixture');
  const historical = { ...pending, outcome: { ...pending.outcome, segment: { ...pending.outcome.segment, id: 'discontinued-gift', label: { fr: 'Ancien cadeau', en: 'Original gift' } } } };
  await seedOnFirstVisit(page, historical);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ancien cadeau', exact: true })).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Original gift', exact: true })).toBeVisible();
  await page.reload();
  expect(await storedParticipation(page)).toEqual(historical);
});

for (const raw of ['{broken', JSON.stringify({ ...participationFixture(), version: 99 })]) {
  test(`malformed or unsupported stored data is preserved and prevents a new participation: ${raw.slice(0, 16)}`, async ({ page }) => {
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: PARTICIPATION_KEY, raw });
    await page.goto('/?preview=win');
    await expect(page.getByRole('alert')).toContainText('Stockage indisponible');
    await expect(page.getByRole('button', { name: 'Je suis abonné(e)' })).toBeDisabled();
    await expect(page.locator('.spin-button')).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), PARTICIPATION_KEY)).toBe(raw);
  });
}

test('storage write failure blocks animation and displays a translated error', async ({ page }) => {
  await ready(page);
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return set.call(this, name, value);
    };
  }, PARTICIPATION_KEY);
  await page.locator('.spin-button').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.spin-button')).toBeDisabled();
  await page.clock.fastForward(gameConfig.spin.durationMs + gameConfig.spin.revealDelayMs + 32);
  await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(0 180 185)');
  expect((await storedParticipation(page)).status).toBe('ready');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('Storage is unavailable');
});

test('concurrent first visits share one stored visitor identity', async ({ page, context }) => {
  const other = await context.newPage();
  await Promise.all([page.goto('/'), other.goto('/')]);
  await expect(page.getByRole('button', { name: 'Je suis abonné(e)' })).toBeDisabled();
  await expect(other.getByRole('button', { name: 'Je suis abonné(e)' })).toBeDisabled();
  const first = await storedParticipation(page);
  expect(await storedParticipation(other)).toEqual(first);
  await openInstagram(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Je suis abonné(e)' }).click();
  await expect(other.locator('.spin-button')).toBeEnabled();
  expect((await storedParticipation(other)).visitorId).toBe(first.visitorId);
});

test('returning after an interrupted loss and its cooldown have elapsed restores immediate eligibility', async ({ page }) => {
  const old = participationFixture('spinning', testNow - 7200000);
  if (old.status !== 'spinning') throw new Error('fixture');
  const loss = { ...old, outcome: { ...old.outcome, index: 0, segment: gameConfig.segments[0]!, rotation: 2497.5 } };
  await page.clock.install({ time: testNow });
  await seedOnFirstVisit(page, loss);
  await page.goto('/');
  await expect(page.locator('.spin-button')).toBeEnabled();
  await expect(page.locator('.wheel-rotor')).toHaveAttribute('transform', 'rotate(2497.5 180 185)');
  expect((await storedParticipation(page)).status).toBe('ready');
});

test('returning at an existing cooldown deadline restores eligibility without requiring a timer tick', async ({ page }) => {
  await page.clock.install({ time: testNow });
  await seedOnFirstVisit(page, participationFixture('cooldown', testNow - 3600000));
  await page.goto('/');
  await expect(page.locator('.spin-button')).toBeEnabled();
  expect((await storedParticipation(page)).status).toBe('ready');
});

test('normal refresh without Web Locks recovers the stored outcome after releasing the fallback lease', async ({ page, context }) => {
  await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { value: undefined }); });
  await ready(page);
  await spin(page);
  await page.clock.fastForward(1000);
  const before = await storedParticipation(page);
  await page.reload();
  await page.clock.runFor(1);
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  const after = await storedParticipation(page);
  expect('outcome' in after && after.outcome).toEqual('outcome' in before && before.outcome);
});
