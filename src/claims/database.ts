import { ClaimError, parseClaim } from './claim';
import type { Claim } from './claim';

export const CLAIMS_DB = 'wheel-of-fortune.claims';
export const CLAIMS_DB_VERSION = 1;
const STORE = 'claims';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      const request = indexedDB.open(CLAIMS_DB, CLAIMS_DB_VERSION);
      request.onupgradeneeded = (event) => {
        try {
          if (event.oldVersion === 0) {
            const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('visitorId', 'visitorId', { unique: true });
          }
        } catch { request.transaction?.abort(); }
      };
      request.onerror = () => {
        settled = true;
        reject(new ClaimError(request.error?.name === 'VersionError' ? 'claimRecordError' : 'claimUnavailable'));
      };
      request.onblocked = () => { settled = true; reject(new ClaimError('claimUnavailable')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (settled) { db.close(); return; }
        settled = true;
        try {
          const store = db.transaction(STORE).objectStore(STORE);
          if (store.keyPath !== 'id' || !store.index('visitorId').unique || store.index('visitorId').keyPath !== 'visitorId') throw new Error();
          resolve(db);
        } catch { db.close(); reject(new ClaimError('claimRecordError')); }
      };
    } catch { reject(new ClaimError('claimUnavailable')); }
  });
}

async function readClaims(visitorId?: string): Promise<Claim[]> {
  const db = await openDatabase();
  try {
    return await new Promise<Claim[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const request = visitorId === undefined ? store.getAll() : store.index('visitorId').get(visitorId);
      tx.oncomplete = () => {
        try {
          const raw: unknown = request.result;
          resolve((visitorId === undefined ? raw as unknown[] : raw === undefined ? [] : [raw]).map(parseClaim));
        } catch { reject(new ClaimError('claimRecordError')); }
      };
      tx.onabort = tx.onerror = () => reject(new ClaimError('claimUnavailable'));
    });
  } finally { db.close(); }
}

export async function findClaim(visitorId: string): Promise<Claim | null> {
  return (await readClaims(visitorId))[0] ?? null;
}
export function listClaims(): Promise<Claim[]> { return readClaims(); }

export async function saveClaim(value: Claim): Promise<Claim> {
  const candidate = parseClaim(value);
  const db = await openDatabase();
  try {
    return await new Promise<Claim>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
      const store = tx.objectStore(STORE);
      let saved = candidate;
      let failure: ClaimError | null = null;
      const request = store.index('visitorId').get(candidate.visitorId);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            saved = parseClaim(request.result);
            if (saved.id !== candidate.id || saved.prizeId !== candidate.prizeId) throw new ClaimError('claimRecordError');
          } else store.add(candidate);
        } catch (error) {
          failure = error instanceof ClaimError ? error : new ClaimError('claimWriteFailed');
          tx.abort();
        }
      };
      // A successful add request can still be rolled back; acknowledge only the transaction commit.
      tx.oncomplete = () => resolve(saved);
      tx.onabort = tx.onerror = () => reject(failure ?? new ClaimError('claimWriteFailed'));
    });
  } finally { db.close(); }
}
