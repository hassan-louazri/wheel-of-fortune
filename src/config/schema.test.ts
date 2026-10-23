import { describe, expect, it } from 'vitest';
import bundledConfig from './game.json';
import { parseGameConfig } from './schema';

describe('game configuration', () => {
  it('accepts the bundled configuration', () => {
    expect(parseGameConfig(bundledConfig)).toEqual(bundledConfig);
    expect(bundledConfig.defaultLanguage).toBe('fr');
  });

  it.each([null, [], 'invalid', {}])('rejects malformed configuration: %j', (value) => {
    expect(() => parseGameConfig(value)).toThrow();
  });

  it.each(['', 'Invalid ID', 42])('rejects invalid ids: %j', (id) => {
    expect(() => parseGameConfig({ ...bundledConfig, id })).toThrow(/id/);
  });

  it('rejects unsupported languages and misspelled fields', () => {
    expect(() => parseGameConfig({ ...bundledConfig, defaultLanguage: 'es' })).toThrow(/defaultLanguage/);
    expect(() => parseGameConfig({ ...bundledConfig, maxWidth: 768 })).toThrow(/unknown field/);
  });

  it.each([0, -1, 769, 390.5, '768', NaN, Infinity])('rejects unsafe viewport limits: %j', (maxViewportWidth) => {
    expect(() => parseGameConfig({ ...bundledConfig, maxViewportWidth })).toThrow(/maxViewportWidth/);
  });

  it.each([undefined, null, [], [bundledConfig.segments[0]], Array(13).fill(bundledConfig.segments[0])])(
    'rejects missing or unsupported segment counts', (segments) => {
      expect(() => parseGameConfig({ ...bundledConfig, segments })).toThrow(/segments/);
    },
  );

  it.each([
    null,
    [],
    { id: 'Bad ID', kind: 'prize', probability: 0.75, label: { fr: 'Cadeau', en: 'Gift' } },
    { id: 'gift', kind: 'unknown', probability: 0.75, label: { fr: 'Cadeau', en: 'Gift' } },
    { id: 'gift', kind: 'prize', probability: 0.75, label: { fr: 'Cadeau' } },
    { id: 'gift', kind: 'prize', probability: 0.75, label: { fr: ' ', en: 'Gift' } },
    { id: 'gift', kind: 'prize', probability: 0.75, label: { fr: 'Cadeau', en: 'Gift', es: 'Regalo' } },
    { id: 'gift', kind: 'prize', probability: 0.75, label: { fr: 'Cadeau', en: 'Gift' }, weight: 10 },
    bundledConfig.segments[0],
  ])('rejects malformed, misspelled or duplicate segments: %j', (segment) => {
    expect(() => parseGameConfig({ ...bundledConfig, segments: [bundledConfig.segments[0], segment] })).toThrow(/segments/);
  });

  it.each(['prize', 'loss'])('requires both outcome kinds rather than only %s', (kind) => {
    const segments = bundledConfig.segments.map((segment) => ({ ...segment, kind }));
    expect(() => parseGameConfig({ ...bundledConfig, segments })).toThrow(/prize and a loss/);
  });

  it.each([undefined, '0.25', -0.1, 1.1, NaN, Infinity])('rejects an invalid segment probability: %s', (probability) => {
    const segments = bundledConfig.segments.map((segment, index) => index === 0 ? { ...segment, probability } : segment);
    expect(() => parseGameConfig({ ...bundledConfig, segments })).toThrow(/probabilit/);
  });

  it.each([0, 0.1, 0.5])('rejects a probability distribution that does not sum to one: %s', (probability) => {
    const segments = bundledConfig.segments.map((segment) => ({ ...segment, probability }));
    expect(() => parseGameConfig({ ...bundledConfig, segments })).toThrow(/sum to 1/);
  });

  it('allows zero-probability visible segments', () => {
    const segments = bundledConfig.segments.map((segment, index) => ({ ...segment, probability: index === 1 ? 1 : 0 }));
    expect(parseGameConfig({ ...bundledConfig, segments }).segments).toEqual(segments);
  });

  it.each([
    undefined, null, [], {},
    { ...bundledConfig.spin, durationMs: 0 },
    { ...bundledConfig.spin, durationMs: 60001 },
    { ...bundledConfig.spin, durationMs: 1.5 },
    { ...bundledConfig.spin, durationMs: NaN },
    { ...bundledConfig.spin, durationMs: '16000' },
    { ...bundledConfig.spin, turns: 0 },
    { ...bundledConfig.spin, turns: 101 },
    { ...bundledConfig.spin, turns: Infinity },
    { ...bundledConfig.spin, turns: 2.5 },
    { ...bundledConfig.spin, revealDelayMs: -1 },
    { ...bundledConfig.spin, revealDelayMs: 10001 },
    { ...bundledConfig.spin, revealDelayMs: '2000' },
    { ...bundledConfig.spin, easing: 'linear' },
  ])('rejects invalid animation configuration: %j', (spin) => {
    expect(() => parseGameConfig({ ...bundledConfig, spin })).toThrow(/spin/);
  });

  it('accepts an immediate result reveal after the animation', () => {
    expect(parseGameConfig({ ...bundledConfig, spin: { ...bundledConfig.spin, revealDelayMs: 0 } }).spin.revealDelayMs).toBe(0);
  });
});

describe('cooldown configuration', () => {
  it('defaults to a 60 minute bundled cooldown', () => { expect(parseGameConfig(bundledConfig).cooldownMinutes).toBe(60); });
  it.each([undefined, null, 0, -1, 1.5, 10081, '60', NaN, Infinity])('rejects invalid cooldownMinutes: %s', (cooldownMinutes) => {
    expect(() => parseGameConfig({ ...bundledConfig, cooldownMinutes })).toThrow(/cooldownMinutes/);
  });
  it.each([1, 10080])('accepts a configurable cooldown of %i minutes', (cooldownMinutes) => {
    expect(parseGameConfig({ ...bundledConfig, cooldownMinutes }).cooldownMinutes).toBe(cooldownMinutes);
  });
});
