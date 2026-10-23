import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBDatabase as FakeDatabase, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { claimFixture } from '../../tests/fixtures/claims';
import { CLAIMS_DB, CLAIMS_DB_VERSION, findClaim, listClaims, saveClaim } from './database';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function rawDatabase(version = CLAIMS_DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLAIMS_DB, version);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('claims', { keyPath: 'id' });
      store.createIndex('visitorId', 'visitorId', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDB claims', () => {
  it('creates version 1 with stable primary ids and a unique visitor index', async () => {
    expect(await listClaims()).toEqual([]);
    const db = await rawDatabase();
    const store = db.transaction('claims').objectStore('claims');
    expect(db.version).toBe(1); expect(store.keyPath).toBe('id'); expect(store.index('visitorId').unique).toBe(true);
    db.close();
  });
  it('persists the complete record across independent connections', async () => {
    const claim = claimFixture();
    expect(await saveClaim(claim)).toEqual(claim);
    expect(await findClaim(claim.visitorId)).toEqual(claim);
    expect(await listClaims()).toEqual([claim]);
  });
  it('serializes concurrent and repeated submissions and never overwrites the first email', async () => {
    const first = claimFixture();
    const other = claimFixture('second@example.com');
    const results = await Promise.all([saveClaim(first), saveClaim(other), saveClaim(first)]);
    expect(results).toEqual([first, first, first]);
    expect(await listClaims()).toEqual([first]);
  });
  it('keys uniqueness by visitor and outcome rather than the email address', async () => {
    const first = claimFixture();
    const visitorId = '00000000-0000-4000-8000-000000000003';
    const id = '00000000-0000-4000-8000-000000000004';
    const second = { ...first, id, visitorId, participation: { ...first.participation, visitorId,
      outcome: { ...first.participation.outcome, id } } };
    await Promise.all([saveClaim(first), saveClaim(second)]);
    expect(await listClaims()).toEqual([first, second]);
  });
  it('rejects a conflicting award for the same visitor without changing the saved record', async () => {
    const claim = claimFixture();
    await saveClaim(claim);
    const id = '00000000-0000-4000-8000-000000000003';
    const conflict = { ...claim, id, participation: { ...claim.participation, outcome: { ...claim.participation.outcome, id } } };
    await expect(saveClaim(conflict)).rejects.toThrow('claimRecordError');
    expect(await listClaims()).toEqual([claim]);
  });
  it('prevents primary-key collisions belonging to different visitors', async () => {
    const claim = claimFixture();
    await saveClaim(claim);
    const visitorId = '00000000-0000-4000-8000-000000000003';
    await expect(saveClaim({ ...claim, visitorId, participation: { ...claim.participation, visitorId } })).rejects.toThrow('claimWriteFailed');
    expect(await listClaims()).toEqual([claim]);
  });
  it('reports unavailable or denied IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(listClaims()).rejects.toThrow('claimUnavailable');
    await expect(saveClaim(claimFixture())).rejects.toThrow('claimUnavailable');
  });
  it('does not acknowledge a successful request from an aborted transaction', async () => {
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = add.call(this, value, key);
      request.onsuccess = () => this.transaction.abort();
      return request;
    });
    await expect(saveClaim(claimFixture())).rejects.toThrow('claimWriteFailed');
    spy.mockRestore();
    expect(await listClaims()).toEqual([]);
    expect(await saveClaim(claimFixture())).toEqual(claimFixture());
  });
  it('reports malformed rows without deleting, skipping or replacing them', async () => {
    const db = await rawDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('claims', 'readwrite');
      tx.objectStore('claims').add({ id: claimFixture().id, visitorId: claimFixture().visitorId, version: 99 });
      tx.oncomplete = () => resolve();
    });
    db.close();
    await expect(listClaims()).rejects.toThrow('claimRecordError');
    await expect(saveClaim(claimFixture())).rejects.toThrow('claimRecordError');
    const check = await rawDatabase();
    await new Promise<void>((resolve) => {
      const request = check.transaction('claims').objectStore('claims').get(claimFixture().id);
      request.onsuccess = () => { expect(request.result.version).toBe(99); resolve(); };
    });
    check.close();
  });
  it('leaves an unknown newer database schema intact', async () => {
    const db = await rawDatabase(2); db.close();
    await expect(listClaims()).rejects.toThrow('claimRecordError');
    const check = await rawDatabase(2); expect(check.version).toBe(2); check.close();
  });
  it('handles database initialization failure without an uncaught upgrade exception', async () => {
    vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError'); });
    await expect(saveClaim(claimFixture())).rejects.toThrow('claimUnavailable');
  });
  it('preserves an existing database whose required unique index is missing', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(CLAIMS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('claims', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close();
    await expect(listClaims()).rejects.toThrow('claimRecordError');
    const check = await rawDatabase();
    expect(check.version).toBe(1);
    expect(check.transaction('claims').objectStore('claims').indexNames.contains('visitorId')).toBe(false);
    check.close();
  });

});
