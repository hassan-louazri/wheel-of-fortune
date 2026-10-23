import { describe, expect, it } from 'vitest';
import { rotationForSegment, segmentAngles } from './geometry';

describe('wheel geometry', () => {
  it('uses equal angles irrespective of selection probabilities', () => {
    expect(segmentAngles(0, 8)).toEqual({ start: -90, center: -67.5, end: -45 });
    expect(segmentAngles(7, 8)).toEqual({ start: 225, center: 247.5, end: 270 });
  });

  it.each([2, 3, 5, 8, 12])('centers every selected segment under the fixed pointer for %s segments', (count) => {
    for (let index = 0; index < count; index++) {
      for (const current of [0, 37, 359.9, 2400.75, 100000]) {
        const target = rotationForSegment(index, count, current, 6);
        expect(target - current).toBeGreaterThanOrEqual(6 * 360);
        expect(target - current).toBeLessThan(7 * 360);
        const pointerAngle = ((-target % 360) + 360) % 360;
        const size = 360 / count;
        expect(Math.floor(pointerAngle / size)).toBe(index);
        expect(pointerAngle - index * size).toBeCloseTo(size / 2, 8);
      }
    }
  });

  it('keeps cumulative clockwise rotation between spins, including the same segment twice', () => {
    const first = rotationForSegment(3, 8, 0, 6);
    const second = rotationForSegment(3, 8, first, 6);
    const third = rotationForSegment(0, 8, second, 6);
    expect(second - first).toBe(2160);
    expect(third).toBeGreaterThan(second);
  });

  it.each([[-1, 8], [8, 8], [0.5, 8], [0, 0], [0, 1], [0, 2.5], [0, Infinity]])(
    'rejects invalid index/count: %s, %s', (index, count) => {
      expect(() => segmentAngles(index, count)).toThrow(/geometry/);
    },
  );

  it.each([[-1, 6], [NaN, 6], [Infinity, 6], [0, 0], [0, 1.5], [0, Infinity]])(
    'rejects invalid starting angle/turn count: %s, %s', (current, turns) => {
      expect(() => rotationForSegment(0, 8, current, turns)).toThrow(/Rotation/);
    },
  );
});
