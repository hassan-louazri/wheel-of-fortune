import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { gameConfig } from '../config';
import { ParticipationStore } from './participation-store';
import { newVisitor, PARTICIPATION_KEY } from './participation';
import { participationFixture } from '../../tests/fixtures/participation';

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
// The browser suite exercises the native implementation; this queue gives unit tests deterministic lock ownership.
function locks() {
  let busy = false;
  const queue: (() => void)[] = [];
  return {
    request: (_name: string, options: LockOptions, callback: (lock: object | null) => unknown) => new Promise((resolve, reject) => {
      const run = () => {
        if (options.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); next(); return; }
        busy = true;
        Promise.resolve().then(() => callback({})).then(resolve, reject).finally(() => { busy = false; next(); });
      };
      const next = () => { if (!busy) queue.shift()?.(); };
      if (busy && options.ifAvailable) { resolve(callback(null)); return; }
      if (busy) queue.push(run); else run();
    }),
  };
}
const settle = async () => { for (let i = 0; i < 30; i++) await setImmediate(); };
async function seedLease(value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${PARTICIPATION_KEY}.lock`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lease');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('lease', 'readwrite');
    tx.objectStore('lease').put(value, 0);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close();
}
let storage: MemoryStorage;
const disposers: (() => void)[] = [];
function store(config = gameConfig) {
  const value = new ParticipationStore(config);
  disposers.push(value.subscribe(() => {}));
  return value;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('navigator', { locks: locks() });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(Math, 'random').mockReturnValue(0.3);
});
afterEach(async () => {
  disposers.splice(0).forEach((dispose) => dispose());
  await settle();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('browser participation persistence', () => {
  it('creates one persistent UUID on the first visit and restores confirmation on return', async () => {
    const first = store();
    await settle();
    const initial = first.getSnapshot().state!;
    expect(initial).toEqual(newVisitor(initial.visitorId));
    expect(initial.visitorId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect((await first.confirmInstagram())?.status).toBe('instagram_required');
    await first.openInstagram();
    await settle();
    await first.confirmInstagram();
    await settle();
    expect(first.getSnapshot().state?.status).toBe('ready');
    const returning = store();
    expect(returning.getSnapshot().state).toEqual(first.getSnapshot().state);
    expect(returning.getSnapshot().state?.visitorId).toBe(initial.visitorId);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('initializes the subscribed store even if Strict Mode discarded an earlier initializer', async () => {
    new ParticipationStore(gameConfig);
    const mounted = store();
    await settle();
    expect(mounted.getSnapshot().state?.status).toBe('instagram_required');
    expect(mounted.getSnapshot().state).toEqual(JSON.parse(storage.getItem(PARTICIPATION_KEY)!));
  });

  it('persists one predetermined snapshot before returning permission to animate and blocks other attempts', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    const result = value.startSpin();
    expect(await value.startSpin()).toBeNull();
    const outcome = await result;
    expect(outcome?.segment.id).toBe('dessert');
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!)).toMatchObject({ status: 'spinning', outcome });
    expect(Math.random).toHaveBeenCalledTimes(1);
    expect(await store().startSpin()).toBeNull();
    value.finishSpin(outcome!.id);
    await settle();
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    expect(await value.startSpin()).toBeNull();
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it('does not recover a live spin in another tab, then recovers immediately when its owner disappears', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const owner = store();
    const outcome = await owner.startSpin();
    const observer = store();
    await settle();
    expect(observer.getSnapshot().state?.status).toBe('spinning');
    expect(Math.random).toHaveBeenCalledTimes(1);
    disposers.shift()!();
    await settle();
    expect(observer.getSnapshot().state).toMatchObject({ status: 'pending_claim', outcome });
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it('queues recovery when a storage update arrives during a losing concurrent start attempt', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const owner = store(); const observer = store();
    const first = owner.startSpin();
    const second = observer.startSpin();
    await Promise.resolve();
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: PARTICIPATION_KEY });
    window.dispatchEvent(event);
    const outcome = await first;
    expect(await second).toBeNull();
    disposers.shift()!();
    await settle();
    expect(observer.getSnapshot().state).toMatchObject({ status: 'pending_claim', outcome });
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it.each(['prize', 'loss'] as const)('recovers a persisted interrupted %s using the original snapshot', async (kind) => {
    const state = participationFixture('spinning');
    if (state.status !== 'spinning') throw new Error('fixture');
    const outcome = { ...state.outcome, segment: gameConfig.segments.find((segment) => segment.kind === kind)! };
    storage.setItem(PARTICIPATION_KEY, JSON.stringify({ ...state, outcome }));
    const value = store();
    await settle();
    expect(value.getSnapshot().state).toMatchObject({ status: kind === 'prize' ? 'pending_claim' : 'cooldown', outcome });
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('retains cooldown deadlines across refresh and config changes, expires automatically and preserves cumulative rotation', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture('cooldown')));
    const value = store({ ...gameConfig, id: 'new-deployment', cooldownMinutes: 1 });
    await vi.advanceTimersByTimeAsync(3599999);
    expect(value.getSnapshot().state?.status).toBe('cooldown');
    const returned = store();
    expect(returned.getSnapshot().state).toEqual(value.getSnapshot().state);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(value.getSnapshot().state).toMatchObject({ status: 'ready', rotation: 2497.5 });
    const outcome = await value.startSpin();
    expect(outcome!.rotation).toBeGreaterThanOrEqual(2497.5 + 2160);
    expect(outcome!.cooldownMs).toBe(60000);
    value.finishSpin(outcome!.id);
  });

  it('handles storage events without overwriting a discontinued prize snapshot', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    const pending = participationFixture('pending_claim');
    if (pending.status !== 'pending_claim') throw new Error('fixture');
    const changed = { ...pending, outcome: { ...pending.outcome, segment: { ...pending.outcome.segment, id: 'retired', label: { fr: 'Ancien cadeau', en: 'Old gift' } } } };
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(changed));
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: PARTICIPATION_KEY });
    window.dispatchEvent(event);
    expect(value.getSnapshot().state).toEqual(changed);
    expect(await value.startSpin()).toBeNull();
    expect(Math.random).not.toHaveBeenCalled();
  });

  it.each(['{broken', JSON.stringify({ ...participationFixture(), version: 99 })])('preserves malformed/outdated data and fails closed: %s', (raw) => {
    storage.setItem(PARTICIPATION_KEY, raw);
    const value = store();
    expect(value.getSnapshot()).toEqual({ state: null, error: true });
    expect(storage.getItem(PARTICIPATION_KEY)).toBe(raw);
  });

  it('never authorizes animation when the outcome cannot be persisted', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    storage.setItem.mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    expect(await value.startSpin()).toBeNull();
    expect(value.getSnapshot()).toMatchObject({ error: true, state: { status: 'ready' } });
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!).status).toBe('ready');
  });

  it('reports inaccessible storage without discarding data or crashing', () => {
    storage.getItem.mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    expect(store().getSnapshot()).toEqual({ state: null, error: true });
  });

  it('uses an IndexedDB lease to protect a live animation and recover on owner unmount without Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const owner = store();
    const outcome = await owner.startSpin();
    const observer = store();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(observer.getSnapshot().state?.status).toBe('spinning');
    expect(await observer.startSpin()).toBeNull();
    disposers.shift()!();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(observer.getSnapshot().state).toMatchObject({ status: 'pending_claim', outcome });
    expect(Math.random).toHaveBeenCalledTimes(1);
    expect([...storage.data.keys()].filter((key) => key.startsWith(`${PARTICIPATION_KEY}.lock`))).toEqual([]);
  });

  it('expires a fallback lease left by a crashed document without changing its persisted outcome', async () => {
    vi.stubGlobal('navigator', {});
    const spinning = participationFixture('spinning');
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(spinning));
    await seedLease({ owner: 'crashed', until: Date.now() + 5000 });
    const value = store();
    for (let elapsed = 0; elapsed < 4; elapsed++) {
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
    }
    await vi.advanceTimersByTimeAsync(999);
    await settle();
    expect(value.getSnapshot().state?.status).toBe('spinning');
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(value.getSnapshot().state?.status).toBe('pending_claim');
    expect(Math.random).not.toHaveBeenCalled();
  });


  it('does not commit a spin if the presentation unmounts before its lock is granted', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    const pending = value.startSpin();
    disposers.shift()!();
    expect(await pending).toBeNull();
    expect(Math.random).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!).status).toBe('ready');
  });

  it('copies prize details instead of retaining a mutable reference to the live configuration', async () => {
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const config = { ...gameConfig, segments: gameConfig.segments.map((segment) => ({ ...segment, label: { ...segment.label } })) };
    const value = store(config);
    const outcome = await value.startSpin();
    config.segments[1]!.label.fr = 'New deployment';
    expect(outcome!.segment.label.fr).toBe('Un dessert offert');
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!).outcome.segment.label.fr).toBe('Un dessert offert');
    value.finishSpin(outcome!.id);
  });


  it('fails closed when fallback lease metadata is corrupted', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    await seedLease({ owner: 'corrupt', until: 'invalid' });
    const value = store();
    expect(await value.startSpin()).toBeNull();
    expect(value.getSnapshot().error).toBe(true);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('atomically grants one of two fallback spin attempts without sampling twice', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const first = store(); const second = store();
    const outcomes = await Promise.all([first.startSpin(), second.startSpin()]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(Math.random).toHaveBeenCalledTimes(1);
    const owner = outcomes[0] ? first : second;
    owner.finishSpin(outcomes.find((outcome) => outcome !== null)!.id);
  });

  it('fails closed without Web Locks when IndexedDB lease storage is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', undefined);
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    expect(await value.startSpin()).toBeNull();
    expect(value.getSnapshot().error).toBe(true);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('does not select an outcome if lease acquisition aborts after a successful write request', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const put = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      request.onsuccess = () => this.transaction.abort();
      return request;
    });
    const value = store();
    expect(await value.startSpin()).toBeNull();
    expect(value.getSnapshot().error).toBe(true);
    expect(Math.random).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getItem(PARTICIPATION_KEY)!).status).toBe('ready');
  });

  it('stops renewing and reports an error if an active fallback lease changes owner', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    const value = store();
    await value.startSpin();
    await seedLease({ owner: 'another-document', until: Date.now() + 5000 });
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(value.getSnapshot().error).toBe(true);
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the fallback shutdown marker cannot be read', async () => {
    vi.stubGlobal('navigator', {});
    storage.setItem(PARTICIPATION_KEY, JSON.stringify(participationFixture()));
    await seedLease({ owner: 'another-document', until: Date.now() + 5000 });
    const read = storage.getItem.getMockImplementation()!;
    storage.getItem.mockImplementation((key) => {
      if (key.endsWith('.closed')) throw new DOMException('Denied', 'SecurityError');
      return read(key);
    });
    const value = store();
    expect(await value.startSpin()).toBeNull();
    expect(value.getSnapshot().error).toBe(true);
    expect(Math.random).not.toHaveBeenCalled();
  });

});
