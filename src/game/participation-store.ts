import type { GameConfig } from '../config/schema';
import { rotationForSegment } from './geometry';
import { selectSegment } from './selection';
import { newVisitor, parseParticipation, PARTICIPATION_KEY, transition } from './participation';
import type { Participation, ParticipationAction, SpinOutcome } from './participation';

const LOCK = `${PARTICIPATION_KEY}.lock`;
// shortcut: without Web Locks, an unclean crash needs lease expiry (up to 5s plus polling) before recovery.
const LEASE_MS = 5000;
interface Snapshot { state: Participation | null; error: boolean }

export class ParticipationStore {
  private snapshot: Snapshot = { state: null, error: false };
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recovery: AbortController | null = null;
  private release: (() => void) | null = null;
  private starting = false;
  private owner = crypto.randomUUID();

  constructor(private config: GameConfig) {
    this.refresh();
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      window.addEventListener('storage', this.onStorage);
      window.addEventListener('pageshow', this.refresh);
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.refresh);
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          this.channel = new BroadcastChannel(PARTICIPATION_KEY);
          this.channel.onmessage = this.refresh;
        } catch { /* Storage events remain available. */ }
      }
      this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      window.removeEventListener('storage', this.onStorage);
      window.removeEventListener('pageshow', this.refresh);
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.refresh);
      this.channel?.close();
      this.channel = null;
      clearTimeout(this.timer);
      this.recovery?.abort();
      this.recovery = null;
      this.onPageHide();
    };
  };

  private read(): Participation {
    const raw = localStorage.getItem(PARTICIPATION_KEY);
    if (raw !== null) return parseParticipation(raw);
    const state = newVisitor(crypto.randomUUID());
    localStorage.setItem(PARTICIPATION_KEY, JSON.stringify(state));
    return state;
  }

  private publish(state: Participation | null, error = false) {
    if (JSON.stringify(this.snapshot) !== JSON.stringify({ state, error })) {
      this.snapshot = { state, error };
      this.listeners.forEach((listener) => listener());
    }
    this.schedule();
  }

  private fail = () => this.publish(this.snapshot.state, true);

  private save(state: Participation) {
    localStorage.setItem(PARTICIPATION_KEY, JSON.stringify(state));
    this.publish(state);
    try { this.channel?.postMessage('changed'); } catch { /* Storage events remain available. */ }
  }

  private onStorage = (event: StorageEvent) => {
    if (event.key === PARTICIPATION_KEY || event.key === null) this.refresh();
  };
  private onPageHide = () => {
    if (!navigator.locks && this.release) {
      // Shutdown can abort an asynchronous IndexedDB release; a tombstone permits immediate reload recovery.
      try { localStorage.setItem(`${LOCK}.closed`, this.owner); } catch { this.fail(); }
    }
    this.release?.();
  };

  refresh = () => {
    try {
      const raw = localStorage.getItem(PARTICIPATION_KEY);
      if (raw !== null) this.publish(parseParticipation(raw));
      else void this.exclusive(() => { this.publish(this.read()); return true; });
    } catch { this.fail(); }
  };

  private schedule() {
    clearTimeout(this.timer);
    if (!this.listeners.size || this.snapshot.error) return;
    const state = this.snapshot.state;
    if (state?.status === 'cooldown') {
      const delay = Math.max(0, Math.min(2147483647, state.cooldownUntil - Date.now()));
      const expire = () => {
        void this.act({ type: 'expire', now: Date.now() }).then((result) => {
          if (!result && this.listeners.size && !this.snapshot.error) this.timer = setTimeout(this.refresh, 25);
        });
      };
      if (delay === 0) expire(); else this.timer = setTimeout(expire, delay);
    } else if (state?.status === 'spinning' && !this.release && !this.starting && !this.recovery) {
      // A queued lock is granted immediately if the animation's document has gone away.
      if (navigator.locks) {
        const recovery = new AbortController();
        this.recovery = recovery;
        void navigator.locks.request(LOCK, { signal: recovery.signal }, () => {
          if (recovery.signal.aborted) return;
          this.resolveStoredSpin();
        }).catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) this.fail();
        }).finally(() => { if (this.recovery === recovery) this.recovery = null; });
      } else {
        this.timer = setTimeout(this.recoverFallback, 0);
      }
    }
  }

  private recoverFallback = () => {
    void this.exclusive(() => { this.resolveStoredSpin(); return true; }).then((resolved) => {
      if (!resolved && this.listeners.size && !this.snapshot.error && this.snapshot.state?.status === 'spinning') {
        this.timer = setTimeout(this.recoverFallback, 1000);
      }
    });
  };

  private resolveStoredSpin() {
    const state = this.read();
    this.save(state.status === 'spinning'
      ? transition(state, { type: 'resolve', spinId: state.outcome.id, now: Date.now() }) : state);
  }

  // Keep the same exclusive lock until reveal; other tabs observe the spin without recovering a live animation.
  private exclusive<T>(task: () => T, hold = false): Promise<T | null> {
    return new Promise((resolve) => {
      const work = async () => {
        try {
          let unlock: (() => void) | undefined;
          const held = new Promise<void>((done) => { unlock = done; });
          if (hold) this.release = () => { this.release = null; unlock!(); };
          const result = task();
          if (hold && result === null) this.release?.();
          if (hold) resolve(result);
          if (hold && result !== null) await held;
          return result;
        } catch {
          this.release?.();
          this.fail();
          return null;
        }
      };
      if (navigator.locks) {
        void navigator.locks.request(LOCK, { ifAvailable: hold }, (lock) => lock ? work() : null)
          .then(resolve).catch(() => { this.fail(); resolve(null); });
      } else {
        void this.withLease(work, hold).then(resolve);
      }
    });
  }

  private openLeaseDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCK, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        try { request.result.createObjectStore('lease'); } catch { request.transaction?.abort(); }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Lease database blocked.')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (blocked) db.close(); else resolve(db);
      };
    });
  }

  private updateLease(db: IDBDatabase, action: 'acquire' | 'renew' | 'release'): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('lease', 'readwrite');
      const store = tx.objectStore('lease');
      const request = store.get(0);
      let acquired = false;
      request.onsuccess = () => {
        try {
          const current: unknown = request.result;
          if (current !== undefined && (typeof current !== 'object' || current === null
            || !('owner' in current) || typeof current.owner !== 'string' || !current.owner
            || !('until' in current) || typeof current.until !== 'number' || !Number.isSafeInteger(current.until) || current.until < 0)) {
            tx.abort(); return;
          }
          acquired = current?.owner === this.owner || action === 'acquire'
            && (current === undefined || (current.until as number) <= Date.now()
              || localStorage.getItem(`${LOCK}.closed`) === current.owner);
          if (action === 'release') {
            if (current?.owner === this.owner) store.delete(0);
          } else if (acquired) store.put({ owner: this.owner, until: Date.now() + LEASE_MS }, 0);
          if (acquired && current && localStorage.getItem(`${LOCK}.closed`) === current.owner) localStorage.removeItem(`${LOCK}.closed`);
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(acquired);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Invalid lease.'));
    });
  }

  private async withLease<T>(work: () => Promise<T | null>, hold: boolean): Promise<T | null> {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let db: IDBDatabase | undefined;
    let acquired = false;
    try {
      // IndexedDB serializes acquisition across renderer processes; localStorage check/set does not.
      db = await this.openLeaseDatabase();
      acquired = await this.updateLease(db, 'acquire');
      while (!acquired) {
        if (hold || !this.listeners.size || this.snapshot.state?.status === 'spinning') return null;
        // Queue short state/claim writes; active spins retain the existing recovery polling.
        acquired = await this.updateLease(db, 'acquire');
      }
      heartbeat = setInterval(() => {
        void this.updateLease(db!, 'renew').then((renewed) => {
          if (!renewed) { this.release?.(); this.fail(); }
        }).catch(() => { this.release?.(); this.fail(); });
      }, 1000);
      return await work();
    } catch { this.fail(); return null; }
    finally {
      clearInterval(heartbeat);
      if (db) {
        try { if (acquired) await this.updateLease(db, 'release'); } catch { this.fail(); }
        db.close();
      }
    }
  }

  private act(action: ParticipationAction) {
    return this.exclusive(() => {
      const state = this.read();
      const next = transition(state, action);
      if (next !== state) this.save(next); else this.publish(state);
      return next;
    });
  }

  openInstagram = () => this.act({ type: 'open_instagram', now: Date.now() });
  confirmInstagram = () => this.act({ type: 'confirm_instagram', now: Date.now() });

  async startSpin(resultDelayMs = this.config.spin.durationMs + this.config.spin.revealDelayMs): Promise<SpinOutcome | null> {
    if (this.starting || this.release) return null;
    this.starting = true;
    try {
      return await this.exclusive(() => {
        const state = transition(this.read(), { type: 'expire', now: Date.now() });
        if (state.status !== 'ready' || !this.listeners.size) { this.publish(state); return null; }
        const index = selectSegment(this.config.segments, Math.random());
        const outcome: SpinOutcome = {
          id: crypto.randomUUID(), segment: structuredClone(this.config.segments[index]!), index,
          rotation: rotationForSegment(index, this.config.segments.length, state.rotation, this.config.spin.turns),
          startedAt: Date.now(), revealAt: Date.now() + resultDelayMs, cooldownMs: this.config.cooldownMinutes * 60000,
        };
        this.save(transition(state, { type: 'start', outcome }));
        return outcome;
      }, true);
    } finally { this.starting = false; this.schedule(); }
  }

  restoreClaim(receipt: Participation): Promise<Participation | null> {
    return this.exclusive(() => {
      const completed = parseParticipation(JSON.stringify(receipt));
      const current = this.read();
      if (completed.status !== 'completed' || current.visitorId !== completed.visitorId
        || 'outcome' in current && current.outcome.segment.kind === 'prize'
        && (current.outcome.id !== completed.outcome.id || current.outcome.segment.id !== completed.outcome.segment.id)) {
        throw new Error('Claim does not match participation.');
      }
      if (JSON.stringify(current) !== JSON.stringify(completed)) this.save(completed);
      else this.publish(current);
      return completed;
    });
  }

  finishSpin(spinId: string) {
    try {
      const state = this.read();
      if (state.status === 'spinning' && state.outcome.id === spinId) {
        this.save(transition(state, { type: 'resolve', spinId, now: Date.now() }));
      }
    } catch { this.fail(); }
    finally { this.release?.(); }
  }
}
