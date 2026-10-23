import type { Page } from '@playwright/test';
import { createClaim, parseClaim } from '../../src/claims/claim';
import type { Claim } from '../../src/claims/claim';
import { CLAIMS_DB, CLAIMS_DB_VERSION } from '../../src/claims/database';
import { participationFixture, testNow } from './participation';

export function claimFixture(email = 'winner@example.com', language: 'fr' | 'en' = 'fr'): Claim {
  return createClaim(participationFixture('pending_claim'), email, language, testNow + 60000);
}
export async function storedClaims(page: Page): Promise<Claim[]> {
  const rows: unknown[] = await page.evaluate(({ name, version }) => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('claims', { keyPath: 'id' });
      store.createIndex('visitorId', 'visitorId', { unique: true });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('claims');
      const all = tx.objectStore('claims').getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result as unknown[]); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { name: CLAIMS_DB, version: CLAIMS_DB_VERSION });
  return rows.map(parseClaim);
}
export async function seedClaim(page: Page, claim: Claim) {
  await storedClaims(page);
  await page.evaluate(({ name, claim }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('claims', 'readwrite');
      tx.objectStore('claims').add(claim);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), { name: CLAIMS_DB, claim });
}
export async function clearClaimsFixture(page: Page) {
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = request.onblocked = () => reject(new Error('Fixture database could not be cleared'));
  }), CLAIMS_DB);
}
