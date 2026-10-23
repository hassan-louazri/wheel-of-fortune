import { validateProbabilities } from '../game/selection.ts';

export type Language = 'fr' | 'en';

export interface WheelSegment {
  readonly id: string;
  readonly label: Readonly<Record<Language, string>>;
  readonly kind: 'prize' | 'loss';
  readonly probability: number;
}

export interface GameConfig {
  readonly id: string;
  readonly defaultLanguage: Language;
  readonly maxViewportWidth: number;
  readonly cooldownMinutes: number;
  readonly segments: readonly WheelSegment[];
  readonly spin: {
    readonly durationMs: number;
    readonly turns: number;
    readonly revealDelayMs: number;
  };
}

export function parseGameConfig(value: unknown): GameConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Game configuration must be an object.');
  }

  if (!('id' in value) || typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) {
    throw new Error('Game configuration id must be a non-empty lowercase slug.');
  }

  if (!('defaultLanguage' in value) || (value.defaultLanguage !== 'fr' && value.defaultLanguage !== 'en')) {
    throw new Error('Game configuration defaultLanguage must be fr or en.');
  }

  if (!('maxViewportWidth' in value) || typeof value.maxViewportWidth !== 'number'
    || !Number.isInteger(value.maxViewportWidth) || value.maxViewportWidth < 1 || value.maxViewportWidth > 768) {
    throw new Error('Game configuration maxViewportWidth must be an integer between 1 and 768.');
  }

  if (Object.keys(value).some((key) => !['id', 'defaultLanguage', 'maxViewportWidth', 'segments', 'spin', 'cooldownMinutes'].includes(key))) {
    throw new Error('Game configuration contains an unknown field.');
  }

  if (!('cooldownMinutes' in value) || typeof value.cooldownMinutes !== 'number'
    || !Number.isInteger(value.cooldownMinutes) || value.cooldownMinutes < 1 || value.cooldownMinutes > 10080) {
    throw new Error('Game configuration cooldownMinutes must be an integer between 1 and 10080.');
  }

  if (!('segments' in value) || !Array.isArray(value.segments) || value.segments.length < 2 || value.segments.length > 12) {
    throw new Error('Game configuration segments must contain between 2 and 12 entries.');
  }

  const ids = new Set<string>();
  const segments: WheelSegment[] = value.segments.map((segment: unknown) => {
    if (typeof segment !== 'object' || segment === null || Array.isArray(segment)
      || !('id' in segment) || typeof segment.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment.id)
      || ids.has(segment.id)
      || !('kind' in segment) || (segment.kind !== 'prize' && segment.kind !== 'loss')
      || !('probability' in segment) || typeof segment.probability !== 'number'
      || !('label' in segment) || typeof segment.label !== 'object' || segment.label === null || Array.isArray(segment.label)
      || !('fr' in segment.label) || typeof segment.label.fr !== 'string' || !segment.label.fr.trim()
      || !('en' in segment.label) || typeof segment.label.en !== 'string' || !segment.label.en.trim()
      || Object.keys(segment).some((key) => !['id', 'kind', 'label', 'probability'].includes(key))
      || Object.keys(segment.label).some((key) => key !== 'fr' && key !== 'en')) {
      throw new Error('Game configuration segments need unique ids, a prize/loss kind, a probability and French/English labels.');
    }
    ids.add(segment.id);
    return { id: segment.id, kind: segment.kind, probability: segment.probability, label: { fr: segment.label.fr, en: segment.label.en } };
  });

  validateProbabilities(segments);

  if (!segments.some((segment) => segment.kind === 'prize') || !segments.some((segment) => segment.kind === 'loss')) {
    throw new Error('Game configuration segments must include a prize and a loss.');
  }

  if (!('spin' in value) || typeof value.spin !== 'object' || value.spin === null || Array.isArray(value.spin)
    || !('durationMs' in value.spin) || typeof value.spin.durationMs !== 'number'
    || !Number.isInteger(value.spin.durationMs) || value.spin.durationMs < 1 || value.spin.durationMs > 60000
    || !('turns' in value.spin) || typeof value.spin.turns !== 'number'
    || !Number.isInteger(value.spin.turns) || value.spin.turns < 1 || value.spin.turns > 100
    || !('revealDelayMs' in value.spin) || typeof value.spin.revealDelayMs !== 'number'
    || !Number.isInteger(value.spin.revealDelayMs) || value.spin.revealDelayMs < 0 || value.spin.revealDelayMs > 10000
    || Object.keys(value.spin).some((key) => !['durationMs', 'turns', 'revealDelayMs'].includes(key))) {
    throw new Error('Game configuration spin needs durationMs (1–60000), turns (1–100), and revealDelayMs (0–10000).');
  }

  return {
    id: value.id,
    defaultLanguage: value.defaultLanguage,
    maxViewportWidth: value.maxViewportWidth,
    cooldownMinutes: value.cooldownMinutes,
    segments,
    spin: { durationMs: value.spin.durationMs, turns: value.spin.turns, revealDelayMs: value.spin.revealDelayMs },
  };
}
