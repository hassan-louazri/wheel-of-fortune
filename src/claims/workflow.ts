import type { Language } from '../config/schema';
import type { ParticipationStore } from '../game/participation-store';
import { assertSameAward, ClaimError, createClaim } from './claim';
import type { Claim } from './claim';
import { findClaim, saveClaim } from './database';

async function complete(store: ParticipationStore, claim: Claim): Promise<Claim> {
  if (!await store.restoreClaim(claim.participation)) throw new ClaimError('claimParticipationError');
  return claim;
}

export async function reconcileClaims(store: ParticipationStore): Promise<Claim | null> {
  const { state, error } = store.getSnapshot();
  if (!state || error) throw new ClaimError('claimParticipationError');
  const claim = await findClaim(state.visitorId);
  if (claim) {
    assertSameAward(state, claim);
    return complete(store, claim);
  }
  if (state.status === 'completed') throw new ClaimError('claimMissing');
  return null;
}

export async function submitClaim(store: ParticipationStore, email: string, language: Language): Promise<Claim> {
  const { state, error } = store.getSnapshot();
  if (!state || error || state.status !== 'pending_claim' && state.status !== 'completed') throw new ClaimError('claimParticipationError');
  const existing = await findClaim(state.visitorId);
  if (existing) {
    assertSameAward(state, existing);
    return complete(store, existing);
  }
  if (state.status === 'completed') throw new ClaimError('claimMissing');
  const saved = await saveClaim(createClaim(state, email, language, Date.now()));
  return complete(store, saved);
}
