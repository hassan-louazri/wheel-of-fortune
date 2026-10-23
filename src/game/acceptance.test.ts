import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config';
import { wheelCases } from '../../tests/fixtures/wheel';
import { adjacentPositiveFloat } from '../../tests/fixtures/adjacent-float';
import { selectSegment } from './selection';
import { rotationForSegment } from './geometry';

describe('Stage 4 configured-segment acceptance', () => {
  it('covers every configured segment in the same wheel order', () => {
    expect(gameConfig.segments.map((segment) => segment.id)).toEqual(wheelCases.map((entry) => entry.id));
    gameConfig.segments.forEach((segment, index) => {
      const entry = wheelCases[index]!;
      expect(segment.probability).toBeCloseTo(entry.upper - entry.lower, 12);
    });
  });

  it.each(wheelCases)('selects $id and centers it beneath the pointer', (entry) => {
    const index = selectSegment(gameConfig.segments, entry.sample);
    expect(gameConfig.segments[index]!.id).toBe(entry.id);
    const angle = rotationForSegment(index, gameConfig.segments.length, 0, gameConfig.spin.turns);
    expect(angle).toBe(entry.rotation);
    const pointerOffset = ((-angle % 360) + 360) % 360;
    expect(pointerOffset).toBe((index + 0.5) * 45);
  });

  for (const [index, entry] of wheelCases.slice(0, -1).entries()) {
    const next = wheelCases[index + 1]!;
    it(`decimal threshold ${entry.upper} belongs to ${next.id}`, () => {
      expect(gameConfig.segments[selectSegment(gameConfig.segments, entry.upper)]!.id).toBe(next.id);
    });

    it(`selects the correct sides immediately around decimal threshold ${entry.upper}`, () => {
      expect(gameConfig.segments[selectSegment(gameConfig.segments, adjacentPositiveFloat(entry.upper, -1))]!.id).toBe(entry.id);
      expect(gameConfig.segments[selectSegment(gameConfig.segments, adjacentPositiveFloat(entry.upper, 1))]!.id).toBe(next.id);
    });
  }

  it('assigns exact JavaScript cumulative thresholds to the following segment', () => {
    let cumulative = 0;
    gameConfig.segments.slice(0, -1).forEach((segment, index) => {
      cumulative += segment.probability;
      expect(selectSegment(gameConfig.segments, cumulative)).toBe(index + 1);
    });
  });

  it('includes zero, selects the final segment just below one, and rejects one', () => {
    expect(gameConfig.segments[selectSegment(gameConfig.segments, 0)]!.id).toBe('loss-1');
    expect(gameConfig.segments[selectSegment(gameConfig.segments, 1 - Number.EPSILON)]!.id).toBe('discount');
    expect(() => selectSegment(gameConfig.segments, 1)).toThrow(/Random value/);
  });
});
