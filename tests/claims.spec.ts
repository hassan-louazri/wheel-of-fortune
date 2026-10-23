import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CLAIMS_DB } from '../src/claims/database';
import { PARTICIPATION_KEY } from '../src/game/participation';
import { claimFixture, seedClaim, storedClaims } from './fixtures/claims';
import { participationFixture, seedOnFirstVisit, storedParticipation, testNow } from './fixtures/participation';

const operatorModule = process.env.PLAYWRIGHT_DEV_SERVER === '1' ? '/src/claims/export.ts' : '/claims-export.js';
async function pending(page: Page) {
  await page.clock.install({ time: testNow });
  await seedOnFirstVisit(page, participationFixture('pending_claim'));
  await page.goto('/');
  await page.clock.pauseAt(testNow + 60000);
  await expect(page.getByRole('button', { name: 'Récupérer mon cadeau' })).toBeEnabled();
}
async function claim(page: Page, email = 'winner@example.com') {
  await page.getByLabel('Votre adresse e-mail').fill(email);
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
}
async function holdDatabase(page: Page) {
  await storedClaims(page);
  return page.evaluateHandle(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('claims', 'readwrite');
    let holding = true;
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    function keepAlive() {
      const request = tx.objectStore('claims').get('test-owned-transaction');
      request.onsuccess = () => { if (holding) keepAlive(); };
    }
    keepAlive();
    return { release: async () => { holding = false; await done; db.close(); } };
  }, CLAIMS_DB);
}

for (const language of ['fr', 'en'] as const) {
  test(`saves a localized ${language} prize claim, confirms it and restores completed participation`, async ({ page, context }) => {
    await pending(page);
    if (language === 'en') await page.getByLabel('Langue').selectOption('en');
    await page.getByLabel(language === 'fr' ? 'Votre adresse e-mail' : 'Your email address').fill(' Winner@EXAMPLE.COM ');
    await page.getByRole('button', { name: language === 'fr' ? 'Récupérer mon cadeau' : 'Claim my gift' }).click();
    await expect(page.getByRole('heading', { name: language === 'fr' ? 'Votre demande est enregistrée' : 'Your claim is saved' })).toBeVisible();
    await expect(page.locator('#claim-email')).toHaveCount(0);
    const rows = await storedClaims(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: '00000000-0000-4000-8000-000000000002', visitorId: '00000000-0000-4000-8000-000000000001',
      prizeId: 'dessert', prizeName: language === 'fr' ? 'Un dessert offert' : 'A free dessert', language, email: 'Winner@example.com',
      wonAt: '2026-10-23T12:00:00.000Z', claimedAt: '2026-10-23T12:01:00.000Z' });
    expect((await storedParticipation(page)).status).toBe('completed');
    expect(await page.evaluate((key) => localStorage.getItem(key), PARTICIPATION_KEY)).not.toContain('Winner@example.com');
    await page.getByRole('button', { name: language === 'fr' ? 'Terminer' : 'Done' }).click();
    await expect(page.locator('.spin-button')).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(language === 'fr' ? 'Merci d’avoir participé ! Vous avez déjà tenté votre chance.' : 'Thanks for taking part! You have already tried your luck.', { exact: true })).toBeVisible();
    const other = await context.newPage(); await other.goto('/');
    await expect(other.locator('.spin-button')).toBeDisabled();
    expect(await storedClaims(other)).toEqual(rows);
  });
}

test('rejects empty, malformed and overlong emails with localized accessible errors and no records', async ({ page }) => {
  await pending(page);
  const email = page.getByLabel('Votre adresse e-mail');
  for (const value of ['', 'invalid', 'a..b@example.com', 'a@localhost', 'a'.repeat(65) + '@example.com']) {
    await email.fill(value);
    await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('adresse e-mail valide');
  }
  await email.evaluate((node) => {
    const value = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await email.inputValue()).toHaveLength(255);
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('valid email address');
  expect(await storedClaims(page)).toEqual([]);
  expect((await storedParticipation(page)).status).toBe('pending_claim');
});

test('opens the complete local French/English privacy drafts without losing the pending form', async ({ page }) => {
  await pending(page);
  await page.getByLabel('Votre adresse e-mail').fill('not-yet-saved@example.com');
  const link = page.getByRole('link', { name: 'Confidentialité (projet)' });
  await expect(link).toHaveAttribute('href', '/privacy/fr.html');
  const [policy] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await expect(policy.getByRole('heading', { name: 'Politique de confidentialité — projet', exact: true })).toBeVisible();
  await expect(policy.locator('html')).toHaveAttribute('lang', 'fr');
  await policy.getByRole('link', { name: 'English', exact: true }).click();
  await expect(policy.getByRole('heading', { name: 'Privacy policy — draft', exact: true })).toBeVisible();
  await expect(policy.locator('html')).toHaveAttribute('lang', 'en');
  await policy.close();
  await expect(page.getByLabel('Votre adresse e-mail')).toHaveValue('not-yet-saved@example.com');
  expect(await storedClaims(page)).toEqual([]);
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('link', { name: 'Privacy policy (draft)' })).toHaveAttribute('href', '/privacy/en.html');
});

test('refresh preserves the original pending prize without saving an unsubmitted email', async ({ page }) => {
  await pending(page);
  await page.getByLabel('Votre adresse e-mail').fill('draft@example.com');
  const state = await storedParticipation(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  await expect(page.getByLabel('Votre adresse e-mail')).toHaveValue('');
  expect(await storedParticipation(page)).toEqual(state);
  expect(await storedClaims(page)).toEqual([]);
});

test('repeated submit events produce one record and one confirmation', async ({ page }) => {
  await pending(page);
  await page.getByLabel('Votre adresse e-mail').fill('winner@example.com');
  await page.locator('.claim-form').evaluate((form) => {
    for (let index = 0; index < 5; index++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
  expect(await storedClaims(page)).toHaveLength(1);
  await page.reload();
  expect(await storedClaims(page)).toHaveLength(1);
});

for (const fallbackLocks of [false, true]) {
  test(`simultaneous submissions from two tabs return the same committed claim${fallbackLocks ? ' without Web Locks' : ''}`, async ({ page, context }) => {
    if (fallbackLocks) await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { value: undefined }); });
    await pending(page);
    const other = await context.newPage();
    await other.clock.install({ time: testNow }); await other.goto('/'); await other.clock.pauseAt(testNow + 60000);
    await expect(other.getByRole('button', { name: 'Récupérer mon cadeau' })).toBeEnabled();
    await page.getByLabel('Votre adresse e-mail').fill('first@example.com');
    await other.getByLabel('Votre adresse e-mail').fill('second@example.com');
    const control = await context.newPage(); await control.goto('/privacy/en.html');
    const hold = await holdDatabase(control);
    try {
      await Promise.all([page, other].map((tab) => tab.locator('.claim-form').dispatchEvent('submit')));
      await expect(page.locator('.claim-form')).toHaveAttribute('aria-busy', 'true');
      await expect(other.locator('.claim-form')).toHaveAttribute('aria-busy', 'true');
    } finally { await hold.evaluate((value) => value.release()); }
    await expect(page.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Votre demande est enregistrée' })).toBeVisible();
    const rows = await storedClaims(page); expect(rows).toHaveLength(1);
    expect(['first@example.com', 'second@example.com']).toContain(rows[0]!.email);
    expect(await storedClaims(other)).toEqual(rows);
    expect(await storedParticipation(page)).toEqual(rows[0]!.participation);
    await control.close();
  });
}

test('refresh during an uncommitted claim keeps the prize pending and allows retry', async ({ page, context }) => {
  await pending(page);
  const control = await context.newPage(); await control.goto('/privacy/en.html');
  const hold = await holdDatabase(control);
  const before = await storedParticipation(page);
  try {
    await page.getByLabel('Votre adresse e-mail').fill('interrupted@example.com');
    await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
    await expect(page.locator('.claim-form')).toHaveAttribute('aria-busy', 'true');
    await page.reload();
  } finally { await hold.evaluate((value) => value.release()); }
  await expect(page.getByRole('button', { name: 'Récupérer mon cadeau' })).toBeEnabled();
  expect(await storedParticipation(page)).toEqual(before);
  expect(await storedClaims(page)).toEqual([]);
  await expect(page.getByLabel('Votre adresse e-mail')).toHaveValue('');
  await claim(page, 'retry@example.com');
  expect(await storedClaims(page)).toHaveLength(1);
  await control.close();
});

test('a committed IndexedDB claim is recovered after localStorage completion fails', async ({ page }) => {
  await pending(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && JSON.parse(value).status === 'completed') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.call(this, name, value);
    };
  }, PARTICIPATION_KEY);
  await page.getByLabel('Votre adresse e-mail').fill('committed@example.com');
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('participation ne peut pas être mise à jour');
  expect((await storedParticipation(page)).status).toBe('pending_claim');
  const rows = await storedClaims(page); expect(rows).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Votre demande est enregistrée' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.completed-notice')).toContainText('Merci d’avoir participé');
  expect((await storedParticipation(page)).status).toBe('completed');
  expect(await storedClaims(page)).toEqual(rows);
});

test('a transaction abort preserves the pending claim, displays an error and can be retried', async ({ page }) => {
  await pending(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      const request = original.call(this, value, key);
      this.transaction.abort(); return request;
    };
  });
  await page.getByLabel('Votre adresse e-mail').fill('winner@example.com');
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('n’a pas pu être enregistrée');
  expect((await storedParticipation(page)).status).toBe('pending_claim');
  expect(await storedClaims(page)).toEqual([]);
  await page.reload();
  await claim(page);
  expect(await storedClaims(page)).toHaveLength(1);
});

test('unavailable IndexedDB preserves pending participation and displays a localized error', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
  await seedOnFirstVisit(page, participationFixture('pending_claim'));
  await page.goto('/');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('stockage des cadeaux est indisponible');
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  await page.getByLabel('Votre adresse e-mail').fill('winner@example.com');
  await page.getByRole('button', { name: 'Récupérer mon cadeau' }).click();
  expect((await storedParticipation(page)).status).toBe('pending_claim');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Gift storage is unavailable');
});

test('startup reconciliation restores an existing winner before permitting a regressed ready state to spin', async ({ page }) => {
  await pending(page); await claim(page);
  const row = (await storedClaims(page))[0]!;
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: PARTICIPATION_KEY, state: participationFixture('ready') });
  await page.reload();
  await expect(page.locator('.spin-button')).toBeDisabled();
  await expect(page.locator('.completed-notice')).toContainText('Merci d’avoir participé');
  expect(await storedParticipation(page)).toEqual(row.participation);
});

test('restored browser origin storage includes IndexedDB claims and completed participation', async ({ page, browser }) => {
  await pending(page); await claim(page);
  const rows = await storedClaims(page);
  const storageState = await page.context().storageState({ indexedDB: true });
  const returned = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
  try {
    const tab = await returned.newPage(); await tab.goto('/');
    await expect(tab.locator('.completed-notice')).toContainText('Merci d’avoir participé');
    await expect(tab.locator('.spin-button')).toBeDisabled();
    await expect(tab.getByRole('dialog')).toHaveCount(0);
    expect(await storedClaims(tab)).toEqual(rows);
  } finally { await returned.close(); }
});

test('programmatic CSV export downloads only this browser’s records with UTF-8, ISO dates and safe cells', async ({ page, browser }) => {
  await pending(page); await claim(page);
  const second = claimFixture('+gift@example.com');
  const visitorId = '00000000-0000-4000-8000-000000000003';
  const id = '00000000-0000-4000-8000-000000000004';
  const name = '=SUM(1,2)\r\n"Café"';
  await seedClaim(page, { ...second, id, visitorId, prizeName: name, participation: { ...second.participation, visitorId,
    outcome: { ...second.participation.outcome, id, segment: { ...second.participation.outcome.segment, label: { ...second.participation.outcome.segment.label, fr: name } } } } });
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const separate = await other.newPage(); await separate.goto('/');
    await seedClaim(separate, claimFixture('other-browser@example.com'));
    const csv: string = await page.evaluate(async (path) => {
      const module = await import(path) as typeof import('../src/claims/export');
      return module.exportClaimsCsv();
    }, operatorModule);
    expect(csv).toContain('\uFEFF"claim_id","visitor_id"');
    expect(csv).toContain('"\'=SUM(1,2)\r\n""Café"""');
    expect(csv).toContain('"\'+gift@example.com"');
    expect(csv).toContain('2026-10-23T12:01:00.000Z');
    expect(csv).not.toContain('other-browser@example.com');
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(async (path) => {
      const module = await import(path) as typeof import('../src/claims/export');
      await module.downloadClaimsCsv();
    }, operatorModule);
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('wheel-claims-2026-10-23.csv');
    expect(await readFile((await download.path())!, 'utf8')).toBe(csv);
    const unchanged = (await storedClaims(page)).find((row) => row.id === id)!;
    expect(unchanged.prizeName).toBe(name); expect(unchanged.email).toBe('+gift@example.com');
  } finally { await other.close(); }
});
