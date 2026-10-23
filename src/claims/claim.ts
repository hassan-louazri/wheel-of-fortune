import type { Language } from '../config/schema';
import { parseParticipation, transition } from '../game/participation';
import type { Participation } from '../game/participation';
import { validateEmail } from './email';

export type ClaimErrorCode = 'emailInvalid' | 'claimUnavailable' | 'claimWriteFailed' | 'claimRecordError' | 'claimParticipationError' | 'claimMissing';
export class ClaimError extends Error {
  constructor(readonly code: ClaimErrorCode) { super(code); }
}
export interface Claim {
  readonly version: 1;
  readonly id: string;
  readonly visitorId: string;
  readonly prizeId: string;
  readonly prizeName: string;
  readonly language: Language;
  readonly email: string;
  readonly wonAt: string;
  readonly claimedAt: string;
  readonly participation: Participation & { readonly status: 'completed' };
}

export function createClaim(state: Participation, email: string, language: Language, now: number): Claim {
  const normalized = validateEmail(email);
  if (!normalized) throw new ClaimError('emailInvalid');
  if (state.status !== 'pending_claim' && state.status !== 'completed') throw new ClaimError('claimRecordError');
  return parseClaim({
    version: 1, id: state.outcome.id, visitorId: state.visitorId, prizeId: state.outcome.segment.id,
    prizeName: state.outcome.segment.label[language], language, email: normalized,
    wonAt: new Date(state.outcome.startedAt).toISOString(), claimedAt: new Date(now).toISOString(),
    participation: transition(state, { type: 'complete' }),
  });
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function parseClaim(value: unknown): Claim {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    const state = parseParticipation(JSON.stringify(row.participation));
    if (row.version !== 1 || state.status !== 'completed' || row.id !== state.outcome.id || row.visitorId !== state.visitorId
      || row.prizeId !== state.outcome.segment.id || row.language !== 'fr' && row.language !== 'en'
      || row.prizeName !== state.outcome.segment.label[row.language] || validateEmail(row.email) !== row.email
      || typeof row.email !== 'string' || !iso(row.wonAt) || !iso(row.claimedAt)
      || row.wonAt !== new Date(state.outcome.startedAt).toISOString()) throw new Error();
    return row as unknown as Claim;
  } catch { throw new ClaimError('claimRecordError'); }
}

export function assertSameAward(state: Participation, claim: Claim) {
  if (state.visitorId !== claim.visitorId || 'outcome' in state && state.outcome.segment.kind === 'prize'
    && (state.outcome.id !== claim.id || state.outcome.segment.id !== claim.prizeId)) throw new ClaimError('claimRecordError');
}
