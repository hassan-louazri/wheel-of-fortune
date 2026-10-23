import type { WheelSegment } from '../config/schema';

export const PARTICIPATION_KEY = 'wheel-of-fortune.participation';
export const INSTAGRAM_URL = 'https://instagram.com/cfoco.france';

export interface SpinOutcome {
  readonly id: string;
  readonly segment: WheelSegment;
  readonly index: number;
  readonly rotation: number;
  readonly startedAt: number;
  readonly revealAt: number;
  readonly cooldownMs: number;
}

interface Visitor {
  readonly version: 1;
  readonly visitorId: string;
  readonly instagramOpenedAt: number | null;
  readonly instagramConfirmedAt: number | null;
  readonly rotation: number;
}

export type Participation = Visitor & (
  | { readonly status: 'instagram_required' | 'ready' }
  | { readonly status: 'spinning'; readonly outcome: SpinOutcome }
  | { readonly status: 'cooldown'; readonly outcome: SpinOutcome; readonly cooldownUntil: number }
  | { readonly status: 'pending_claim' | 'completed'; readonly outcome: SpinOutcome }
);

export type ParticipationAction =
  | { type: 'open_instagram'; now: number }
  | { type: 'confirm_instagram'; now: number }
  | { type: 'start'; outcome: SpinOutcome }
  | { type: 'resolve'; spinId: string; now: number }
  | { type: 'expire'; now: number }
  | { type: 'complete' };

export function newVisitor(visitorId: string): Participation {
  return { version: 1, visitorId, instagramOpenedAt: null, instagramConfirmedAt: null, rotation: 0, status: 'instagram_required' };
}

export function transition(state: Participation, action: ParticipationAction): Participation {
  switch (action.type) {
    case 'open_instagram':
      return state.status === 'instagram_required' && state.instagramOpenedAt === null
        ? { ...state, instagramOpenedAt: action.now } : state;
    case 'confirm_instagram':
      return state.status === 'instagram_required' && state.instagramOpenedAt !== null
        ? { ...state, status: 'ready', instagramConfirmedAt: action.now } : state;
    case 'start':
      return state.status === 'ready' ? { ...state, status: 'spinning', outcome: action.outcome } : state;
    case 'resolve': {
      if (state.status !== 'spinning' || state.outcome.id !== action.spinId) return state;
      const common = { ...state, rotation: state.outcome.rotation };
      const cooldownUntil = Math.min(action.now, state.outcome.revealAt) + state.outcome.cooldownMs;
      return state.outcome.segment.kind === 'prize'
        ? { ...common, status: 'pending_claim' }
        : transition({ ...common, status: 'cooldown', cooldownUntil }, { type: 'expire', now: action.now });
    }
    case 'expire':
      if (state.status !== 'cooldown' || action.now < state.cooldownUntil) return state;
      return {
        version: 1, visitorId: state.visitorId, instagramOpenedAt: state.instagramOpenedAt,
        instagramConfirmedAt: state.instagramConfirmedAt, rotation: state.rotation, status: 'ready',
      };
    case 'complete':
      return state.status === 'pending_claim' ? { ...state, status: 'completed' } : state;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}
function validOutcome(value: unknown): value is SpinOutcome {
  if (!record(value) || !uuid(value.id) || !timestamp(value.startedAt)
    || !timestamp(value.revealAt) || value.revealAt < value.startedAt || value.revealAt - value.startedAt > 70000
    || !(typeof value.rotation === 'number' && Number.isFinite(value.rotation) && value.rotation >= 0)
    || !timestamp(value.cooldownMs) || value.cooldownMs === 0 || !timestamp(value.index) || value.index > 11) return false;
  const segment = value.segment;
  return record(segment) && typeof segment.id === 'string' && segment.id.length > 0
    && (segment.kind === 'prize' || segment.kind === 'loss') && record(segment.label)
    && typeof segment.label.fr === 'string' && segment.label.fr.trim().length > 0
    && typeof segment.label.en === 'string' && segment.label.en.trim().length > 0
    && typeof segment.probability === 'number' && Number.isFinite(segment.probability)
    && segment.probability >= 0 && segment.probability <= 1;
}

// Stored awards are validated independently of today's configuration and never silently reset.
export function parseParticipation(raw: string): Participation {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || !uuid(value.visitorId)
    || !(value.instagramOpenedAt === null || timestamp(value.instagramOpenedAt))
    || !(value.instagramConfirmedAt === null || timestamp(value.instagramConfirmedAt))
    || typeof value.rotation !== 'number' || !Number.isFinite(value.rotation) || value.rotation < 0) {
    throw new Error('Invalid or unsupported participation data.');
  }
  if (value.status === 'instagram_required') {
    if (value.instagramConfirmedAt !== null) throw new Error('Invalid Instagram state.');
  } else {
    if (!timestamp(value.instagramOpenedAt) || !timestamp(value.instagramConfirmedAt)) throw new Error('Missing Instagram confirmation.');
    if (value.status !== 'ready') {
      if (!validOutcome(value.outcome)) throw new Error('Invalid stored outcome.');
      if (value.status === 'cooldown') {
        if (value.outcome.segment.kind !== 'loss' || !timestamp(value.cooldownUntil)
          || value.cooldownUntil < value.outcome.cooldownMs
          || value.cooldownUntil > value.outcome.revealAt + value.outcome.cooldownMs) throw new Error('Invalid cooldown.');
      } else if (value.status === 'pending_claim' || value.status === 'completed') {
        if (value.outcome.segment.kind !== 'prize') throw new Error('Invalid prize.');
      } else if (value.status !== 'spinning') throw new Error('Unknown participation state.');
    }
  }
  return value as unknown as Participation;
}

export function countdown(until: number, now: number) {
  const total = Math.max(0, Math.ceil((until - now) / 1000));
  return { total, hours: Math.floor(total / 3600), minutes: Math.floor(total / 60) % 60, seconds: total % 60 };
}
