import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { gameConfig } from '../config';
import { ParticipationStore } from '../game/participation-store';
import { PARTICIPATION_KEY } from '../game/participation';
import { claimFixture } from '../../tests/fixtures/claims';
import { participationFixture, testNow } from '../../tests/fixtures/participation';
import { findClaim, listClaims, saveClaim } from './database';
import { reconcileClaims, submitClaim } from './workflow';

class StorageMemory {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = (key: string) => { this.data.delete(key); };
}
let storage: StorageMemory;
const cleanup: (() => void)[] = [];
function store() {
  const value = new ParticipationStore(gameConfig);
  cleanup.push(value.subscribe(() => {}));
  return value;
}
beforeEach(() => {
  storage = new StorageMemory();
  storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture('pending_claim')));
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('navigator', {}); vi.stubGlobal('BroadcastChannel', undefined);
  vi.spyOn(Date, 'now').mockReturnValue(testNow + 60000);
});
afterEach(() => { cleanup.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('claim completion and recovery', () => {
  it('completes participation only after the claim transaction commits', async () => {
    const value = store();
    const request = submitClaim(value, 'winner@example.com', 'fr');
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    const claim = await request;
    expect(await findClaim(claim.visitorId)).toEqual(claim);
    expect(value.getSnapshot().state).toEqual(claim.participation);
  });
  it('returns the immutable existing claim on retry, including changed input', async () => {
    const value = store();
    const first = await submitClaim(value, 'winner@example.com', 'fr');
    expect(await submitClaim(value, 'invalid', 'en')).toEqual(first);
    expect(await listClaims()).toEqual([first]);
  });
  it('preserves a pending claim and its outcome if IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const value = store(); const before = value.getSnapshot().state;
    await expect(submitClaim(value, 'winner@example.com', 'fr')).rejects.toThrow('claimUnavailable');
    expect(value.getSnapshot().state).toEqual(before);
  });
  it('preserves pending participation on transaction abort and allows an idempotent retry', async () => {
    const value = store();
    const add = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, row, key) {
      const request = add.call(this, row, key); this.transaction.abort(); return request;
    });
    await expect(submitClaim(value, 'winner@example.com', 'fr')).rejects.toThrow('claimWriteFailed');
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    spy.mockRestore();
    expect(await listClaims()).toEqual([]);
    await submitClaim(value, 'winner@example.com', 'fr');
    expect(value.getSnapshot().state?.status).toBe('completed');
  });
  it('reconciles an interruption after IndexedDB commit but before localStorage completion', async () => {
    const saved = await saveClaim(claimFixture());
    const value = store();
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    expect(await reconcileClaims(value)).toEqual(saved);
    expect(value.getSnapshot().state).toEqual(saved.participation);
    expect(await listClaims()).toEqual([saved]);
  });
  it('retains the committed record when localStorage fails, then recovers on a later successful startup', async () => {
    const value = store();
    storage.setItem.mockImplementation((key, raw) => {
      if (key === PARTICIPATION_KEY && JSON.parse(raw).status === 'completed') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      storage.data.set(key, raw);
    });
    await expect(submitClaim(value, 'winner@example.com', 'fr')).rejects.toThrow('claimParticipationError');
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!).status).toBe('pending_claim');
    const records = await listClaims(); expect(records).toHaveLength(1);
    storage.setItem.mockImplementation((key, raw) => { storage.data.set(key, raw); });
    const returned = store();
    expect(await reconcileClaims(returned)).toEqual(records[0]);
    expect(returned.getSnapshot().state?.status).toBe('completed');
  });
  it('restores an existing winner if valid localStorage regressed to ready', async () => {
    const claim = await saveClaim(claimFixture());
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture('ready')));
    const value = store();
    await reconcileClaims(value);
    expect(value.getSnapshot().state).toEqual(claim.participation);
  });
  it('does not complete, discard or overwrite a different pending prize', async () => {
    const saved = await saveClaim(claimFixture());
    const pending = participationFixture('pending_claim');
    if (pending.status !== 'pending_claim') throw new Error('fixture');
    const different = { ...pending, outcome: { ...pending.outcome, id: '00000000-0000-4000-8000-000000000003' } };
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(different));
    const value = store();
    await expect(reconcileClaims(value)).rejects.toThrow('claimRecordError');
    expect(value.getSnapshot().state).toEqual(different);
    expect(await listClaims()).toEqual([saved]);
  });
  it('reports completed participation with a missing record without inventing a replacement claim', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture('completed')));
    const value = store();
    await expect(reconcileClaims(value)).rejects.toThrow('claimMissing');
    expect(await listClaims()).toEqual([]);
    expect(value.getSnapshot().state?.status).toBe('completed');
  });
  it('preserves the existing fail-closed behavior for corrupted participation', async () => {
    const saved = await saveClaim(claimFixture());
    storage.setItem(PARTICIPATION_KEY, '{broken');
    const value = store();
    await expect(reconcileClaims(value)).rejects.toThrow('claimParticipationError');
    expect(storage.getItem(PARTICIPATION_KEY)).toBe('{broken');
    expect(await listClaims()).toEqual([saved]);
  });
  it('leaves an unsubmitted pending claim intact on a normal startup', async () => {
    const value = store(); const before = value.getSnapshot().state;
    expect(await reconcileClaims(value)).toBeNull();
    expect(value.getSnapshot().state).toEqual(before);
  });
});
