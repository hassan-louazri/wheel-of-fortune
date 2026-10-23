import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config';
import { countdown, newVisitor, parseParticipation, transition } from './participation';
import type { Participation, SpinOutcome } from './participation';

const visitorId = '00000000-0000-4000-8000-000000000001';
const ready = transition(transition(newVisitor(visitorId), { type: 'open_instagram', now: 10 }), { type: 'confirm_instagram', now: 20 });
const outcome: SpinOutcome = {
  id: '00000000-0000-4000-8000-000000000002', segment: gameConfig.segments[1]!, index: 1,
  rotation: 2452.5, startedAt: 30, revealAt: 100, cooldownMs: 3600000,
};
const start = (selected = outcome) => transition(ready, { type: 'start', outcome: selected });

describe('participation transitions', () => {
  it('requires opening Instagram before confirmation and retains visitor identity', () => {
    const first = newVisitor(visitorId);
    expect(transition(first, { type: 'confirm_instagram', now: 0 })).toBe(first);
    expect(transition(first, { type: 'start', outcome })).toBe(first);
    expect(ready).toMatchObject({ status: 'ready', visitorId, instagramOpenedAt: 10, instagramConfirmedAt: 20 });
    expect(transition(ready, { type: 'open_instagram', now: 100 })).toBe(ready);
  });

  it('commits one outcome, blocks repeated starts, and resolves only that spin', () => {
    const spinning = start();
    expect(transition(spinning, { type: 'start', outcome: { ...outcome, id: visitorId } })).toBe(spinning);
    expect(transition(spinning, { type: 'resolve', spinId: visitorId, now: 40 })).toBe(spinning);
    const pending = transition(spinning, { type: 'resolve', spinId: outcome.id, now: 40 });
    expect(pending).toMatchObject({ status: 'pending_claim', rotation: outcome.rotation, outcome });
    expect(transition(pending, { type: 'start', outcome })).toBe(pending);
    expect(transition(pending, { type: 'expire', now: Number.MAX_SAFE_INTEGER })).toBe(pending);
    const completed = transition(pending, { type: 'complete' });
    expect(completed.status).toBe('completed');
    expect(transition(completed, { type: 'start', outcome })).toBe(completed);
  });

  it('starts a timestamp-based cooldown on loss resolution, expires exactly at the deadline and keeps rotation', () => {
    const loss = { ...outcome, segment: gameConfig.segments[0]! };
    const cooldown = transition(start(loss), { type: 'resolve', spinId: loss.id, now: 100 });
    expect(cooldown).toMatchObject({ status: 'cooldown', cooldownUntil: 3600100 });
    expect(transition(cooldown, { type: 'start', outcome })).toBe(cooldown);
    expect(transition(cooldown, { type: 'complete' })).toBe(cooldown);
    expect(transition(cooldown, { type: 'expire', now: 3600099 })).toBe(cooldown);
    const again = transition(cooldown, { type: 'expire', now: 3600100 });
    expect(again).toEqual({ ...ready, rotation: loss.rotation });
    expect(transition(again, { type: 'start', outcome }).status).toBe('spinning');
  });

  it('honors time already elapsed while an interrupted losing spin was closed', () => {
    const loss = { ...outcome, segment: gameConfig.segments[0]! };
    const interrupted = start(loss);
    const late = transition(interrupted, { type: 'resolve', spinId: loss.id, now: loss.revealAt + loss.cooldownMs });
    expect(late).toMatchObject({ status: 'ready', rotation: loss.rotation });
    const early = transition(interrupted, { type: 'resolve', spinId: loss.id, now: 50 });
    expect(early).toMatchObject({ status: 'cooldown', cooldownUntil: 50 + loss.cooldownMs });
  });

  it.each(['prize', 'loss'] as const)('recovers an interrupted %s without sampling a replacement', (kind) => {
    const selected = { ...outcome, segment: gameConfig.segments.find((segment) => segment.kind === kind)! };
    const restored = parseParticipation(JSON.stringify(start(selected)));
    const result = transition(restored, { type: 'resolve', spinId: selected.id, now: 100 });
    expect(result.status).toBe(kind === 'prize' ? 'pending_claim' : 'cooldown');
    expect('outcome' in result && result.outcome).toEqual(selected);
    expect(transition(result, { type: 'resolve', spinId: selected.id, now: 200 })).toBe(result);
  });
});

describe('persistent data boundary', () => {
  const states: Participation[] = [newVisitor(visitorId), ready, start(),
    transition(start(), { type: 'resolve', spinId: outcome.id, now: 40 }),
    transition(start({ ...outcome, segment: gameConfig.segments[0]! }), { type: 'resolve', spinId: outcome.id, now: 40 }),
    transition(transition(start(), { type: 'resolve', spinId: outcome.id, now: 40 }), { type: 'complete' }),
  ];
  it.each(states)('round-trips $status independently of the current configuration', (state) => {
    expect(parseParticipation(JSON.stringify(state))).toEqual(state);
  });
  it('retains discontinued prize snapshots and cooldown durations across configuration changes', () => {
    const changed = { ...outcome, segment: { ...outcome.segment, id: 'retired-gift', label: { fr: 'Cadeau historique', en: 'Historic gift' } }, cooldownMs: 120000 };
    const restored = parseParticipation(JSON.stringify(start(changed)));
    expect(restored).toMatchObject({ outcome: changed });
  });
  it.each([
    '{', 'null', '[]', '{}', JSON.stringify({ ...ready, version: 0 }), JSON.stringify({ ...ready, version: 2 }),
    JSON.stringify({ ...ready, visitorId: 'invalid' }), JSON.stringify({ ...ready, instagramConfirmedAt: null }),
    JSON.stringify({ ...ready, rotation: -1 }), JSON.stringify({ ...ready, status: 'unknown' }),
    JSON.stringify({ ...start(), outcome: { ...outcome, segment: { ...outcome.segment, label: { fr: 'Gift' } } } }),
    JSON.stringify({ ...start(), outcome: { ...outcome, cooldownMs: 0 } }),
    JSON.stringify({ ...start(), outcome: { ...outcome, index: 99 } }),
    JSON.stringify({ ...start(), status: 'cooldown', cooldownUntil: 100 }),
    JSON.stringify({ ...start({ ...outcome, segment: gameConfig.segments[0]! }), status: 'pending_claim' }),
  ])('rejects malformed or unsupported data without replacing it: %s', (raw) => {
    expect(() => parseParticipation(raw)).toThrow();
  });
  it('derives a nonnegative countdown from timestamps with second rounding', () => {
    expect(countdown(3600000, 0)).toEqual({ total: 3600, hours: 1, minutes: 0, seconds: 0 });
    expect(countdown(3600000, 1)).toEqual({ total: 3600, hours: 1, minutes: 0, seconds: 0 });
    expect(countdown(3600000, 1000)).toEqual({ total: 3599, hours: 0, minutes: 59, seconds: 59 });
    expect(countdown(3600000, 3600001)).toEqual({ total: 0, hours: 0, minutes: 0, seconds: 0 });
  });
  it.each([0, 3599999, 3600101])('rejects an impossible cooldown deadline: %s', (cooldownUntil) => {
    const loss = { ...outcome, segment: gameConfig.segments[0]! };
    const cooldown = transition(start(loss), { type: 'resolve', spinId: loss.id, now: 100 });
    expect(() => parseParticipation(JSON.stringify({ ...cooldown, cooldownUntil }))).toThrow('Invalid cooldown');
  });
});
