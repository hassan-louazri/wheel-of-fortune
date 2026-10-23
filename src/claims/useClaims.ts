import { useEffect, useRef, useState } from 'react';
import type { Language } from '../config/schema';
import type { ParticipationStore } from '../game/participation-store';
import { ClaimError } from './claim';
import type { Claim, ClaimErrorCode } from './claim';
import { reconcileClaims, submitClaim } from './workflow';

export function useClaims(store: ParticipationStore, visitorId: string | undefined, participationError: boolean) {
  const [checkedVisitor, setCheckedVisitor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClaimErrorCode | null>(null);
  const [confirmed, setConfirmed] = useState<Claim | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let active = true;
    if (!visitorId || participationError) return;
    void reconcileClaims(store).then(() => { if (active) setError(null); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof ClaimError ? reason.code : 'claimUnavailable');
    }).finally(() => { if (active) setCheckedVisitor(visitorId); });
    return () => { active = false; };
  }, [store, visitorId, participationError]);

  function submit(email: string, language: Language): Promise<void> {
    if (inFlight.current) return inFlight.current;
    setSaving(true);
    setError(null);
    const task = submitClaim(store, email, language).then(setConfirmed).catch((reason: unknown) => {
      setError(reason instanceof ClaimError ? reason.code : 'claimWriteFailed');
    }).finally(() => { inFlight.current = null; setSaving(false); });
    inFlight.current = task;
    return task;
  }
  return { checking: !participationError && checkedVisitor !== visitorId, saving, error, confirmed, submit };
}
