import { describe, expect, it } from 'vitest';
import { selectSegment, validateProbabilities } from './selection';
import { adjacentPositiveFloat } from '../../tests/fixtures/adjacent-float';

const segments = [0, 0.25, 0, 0.5, 0.25, 0].map((probability) => ({ probability }));

describe('weighted selection', () => {
  it.each([
    [0, 1], [0.25 - Number.EPSILON, 1], [0.25, 3],
    [0.75 - Number.EPSILON, 3], [0.75, 4], [1 - Number.EPSILON, 4],
  ])('selects the correct interval for random value %s', (random, index) => {
    expect(selectSegment(segments, random)).toBe(index);
  });

  it('never selects zero-probability segments, including leading and trailing entries', () => {
    const certain = [0, 0, 1, 0].map((probability) => ({ probability }));
    for (const random of [0, 0.1, 0.5, 1 - Number.EPSILON]) expect(selectSegment(certain, random)).toBe(2);
  });

  it('accepts decimal rounding without leaving an unassigned outcome', () => {
    const decimal = [0.1, 0.2, 0.7, 0].map((probability) => ({ probability }));
    expect(selectSegment(decimal, 1 - Number.EPSILON)).toBe(2);
    expect(selectSegment([{ probability: 1 - 5e-10 }, { probability: 0 }], 1 - Number.EPSILON)).toBe(0);
  });

  it.each([
    { probabilities: [0.1, 0.2, 0.7], boundary: 0.3 },
    { probabilities: [0.0000001, 0.0000002, 0.9999997], boundary: 0.0000003 },
    { probabilities: [0.0000000000000001, 0.9999999999999999], boundary: 0.0000000000000001 },
  ])('keeps exact decimal boundaries at $boundary, including scientific notation and large integer scales', ({ probabilities, boundary }) => {
    const entries = probabilities.map((probability) => ({ probability }));
    const next = entries.length - 1;
    expect(selectSegment(entries, adjacentPositiveFloat(boundary, -1))).toBe(next - 1);
    expect(selectSegment(entries, boundary)).toBe(next);
    expect(selectSegment(entries, adjacentPositiveFloat(boundary, 1))).toBe(next);
  });

  it('preserves subnormal positive weights and skips zero intervals at their boundary', () => {
    const entries = [0, Number.MIN_VALUE, 0, 1, 0].map((probability) => ({ probability }));
    expect(selectSegment(entries, 0)).toBe(1);
    expect(selectSegment(entries, Number.MIN_VALUE)).toBe(3);
  });

  it('skips consecutive zero weights exactly at a decimal boundary', () => {
    const entries = [0, 0.1, 0.2, 0, 0, 0.7, 0].map((probability) => ({ probability }));
    expect(selectSegment(entries, adjacentPositiveFloat(0.3, -1))).toBe(2);
    expect(selectSegment(entries, 0.3)).toBe(5);
    expect(selectSegment(entries, adjacentPositiveFloat(0.3, 1))).toBe(5);
    expect(selectSegment(entries, adjacentPositiveFloat(1, -1))).toBe(5);
  });

  it.each([-1, 1, NaN, Infinity, -Infinity])('rejects an invalid random value: %s', (random) => {
    expect(() => selectSegment(segments, random)).toThrow(/Random value/);
  });

  it.each([[], [0, 0], [0.4, 0.4], [0.6, 0.6], [-0.2, 1.2], [NaN, 1], [Infinity, 0]].map((probabilities) => ({ probabilities })))(
    'rejects invalid probabilities: $probabilities', ({ probabilities }) => {
      const invalid = probabilities.map((probability) => ({ probability }));
      expect(() => validateProbabilities(invalid)).toThrow(/probabilit/);
      expect(() => selectSegment(invalid, 0.5)).toThrow(/probabilit/);
    },
  );
});
