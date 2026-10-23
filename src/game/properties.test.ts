import { describe, expect, it } from 'vitest';
import { participationFixture, testNow } from '../../tests/fixtures/participation';
import { rotationForSegment, segmentAngles } from './geometry';
import { countdown, parseParticipation, transition } from './participation';
import type { ParticipationAction } from './participation';
import { selectSegment } from './selection';

describe('deterministic generated game properties', () => {
  for (let count = 2; count <= 12; count++) {
    it(`matches an integer interval oracle for ${count} segments, including zero weights`, () => {
      for (let seed = 0; seed < 4; seed++) {
        // Integer partitions give an independent exact oracle for the decimal boundary contract.
        const cuts = [0, ...Array.from({ length: count - 1 }, (_, index) => ((index + seed) * 37) % 101), 100].sort((a, b) => a - b);
        const weights = cuts.slice(1).map((end, index) => end - cuts[index]!);
        const segments = weights.map((weight) => ({ probability: weight / 100 }));
        const hits = weights.map(() => 0);
        for (let sample = 0; sample < 100; sample++) {
          const expected = cuts.findIndex((end) => end > sample) - 1;
          const actual = selectSegment(segments, sample / 100);
          expect(actual).toBe(expected);
          hits[actual]!++;
        }
        expect(hits).toEqual(weights);
      }
    });

    it(`preserves clockwise continuity and pointer centering for ${count} segments`, () => {
      let rotation = 0.125;
      for (let spin = 0; spin < 100; spin++) {
        const index = (spin * 7) % count;
        const next = rotationForSegment(index, count, rotation, 6);
        expect(next - rotation).toBeGreaterThanOrEqual(2160 - 1e-8);
        expect(next - rotation).toBeLessThan(2520 + 1e-8);
        const { center } = segmentAngles(index, count);
        const error = ((center + next + 90) % 360 + 360) % 360;
        expect(Math.min(error, 360 - error)).toBeLessThan(1e-7);
        rotation = next;
      }
    });
  }

  for (const status of ['instagram_required', 'ready', 'spinning', 'cooldown', 'pending_claim', 'completed'] as const) {
    it(`allows only the valid actions from ${status} and preserves the original input`, () => {
      const state = participationFixture(status);
      const spinning = participationFixture('spinning');
      if (spinning.status !== 'spinning') throw new Error('fixture');
      const actions: ParticipationAction[] = [
        { type: 'open_instagram', now: testNow }, { type: 'confirm_instagram', now: testNow },
        { type: 'start', outcome: spinning.outcome },
        { type: 'resolve', spinId: spinning.outcome.id, now: testNow + 18000 },
        { type: 'expire', now: testNow + 3600000 }, { type: 'complete' },
      ];
      const targets = {
        instagram_required: ['instagram_required', 'instagram_required', 'instagram_required', 'instagram_required', 'instagram_required', 'instagram_required'],
        ready: ['ready', 'ready', 'spinning', 'ready', 'ready', 'ready'],
        spinning: ['spinning', 'spinning', 'spinning', 'pending_claim', 'spinning', 'spinning'],
        cooldown: ['cooldown', 'cooldown', 'cooldown', 'cooldown', 'ready', 'cooldown'],
        pending_claim: ['pending_claim', 'pending_claim', 'pending_claim', 'pending_claim', 'pending_claim', 'completed'],
        completed: ['completed', 'completed', 'completed', 'completed', 'completed', 'completed'],
      }[status];
      const original = JSON.stringify(state);
      actions.forEach((action, index) => {
        const next = transition(state, action);
        expect(next.status).toBe(targets[index]);
        expect(parseParticipation(JSON.stringify(next))).toEqual(next);
        expect(next.visitorId).toBe(state.visitorId);
        expect(JSON.stringify(state)).toBe(original);
      });
    });
  }

  it('rounds countdowns up without extending their deadlines across supported cooldown lengths', () => {
    for (const minutes of [1, 60, 10080]) {
      const until = testNow + minutes * 60000;
      for (const remaining of [-1001, -1, 0, 1, 999, 1000, 1001, minutes * 60000]) {
        const value = countdown(until, until - remaining);
        expect(value.total).toBe(Math.max(0, Math.ceil(remaining / 1000)));
        expect(value.hours * 3600 + value.minutes * 60 + value.seconds).toBe(value.total);
        expect(value.minutes).toBeGreaterThanOrEqual(0);
        expect(value.minutes).toBeLessThan(60);
        expect(value.seconds).toBeGreaterThanOrEqual(0);
        expect(value.seconds).toBeLessThan(60);
      }
    }
  });
});
