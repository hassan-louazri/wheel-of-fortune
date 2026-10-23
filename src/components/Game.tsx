import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { gameConfig } from '../config';
import { Dialog } from './Dialog';
import { Landing } from './Landing';
import { LosingScreen } from './LosingScreen';
import { Wheel } from './Wheel';
import { WinningDialog } from './WinningDialog';
import { LanguageDialog } from './LanguageSelector';
import { ViewportGate } from './ViewportGate';
import { WheelAnimation } from '../game/animation';
import { useClaims } from '../claims/useClaims';
import { ParticipationStore } from '../game/participation-store';

type Popup = 'reminder' | 'rules' | null;

export function Game({ languageOpen, onLanguageClose }: { languageOpen: boolean; onLanguageClose: () => void }) {
  const { t } = useTranslation();
  const [store] = useState(() => new ParticipationStore(gameConfig));
  const { state, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const claims = useClaims(store, state?.visitorId, error);
  const [popup, setPopup] = useState<Popup>(null);
  const [dismissedClaim, setDismissedClaim] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);
  const rotor = useRef<SVGGElement | null>(null);
  const [animation] = useState(() => new WheelAnimation((rotation) => {
    rotor.current?.setAttribute('transform', `rotate(${rotation} 180 185)`);
  }));
  const currentRotation = state?.rotation ?? 0;
  const attachRotor = useCallback((node: SVGGElement | null) => {
    rotor.current = node;
    if (!animation.busy) animation.rotation = currentRotation;
    node?.setAttribute('transform', `rotate(${animation.rotation} 180 185)`);
  }, [animation, currentRotation]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; animation.cancel(); };
  }, [animation]);
  useEffect(() => {
    if (state?.status !== 'spinning' && animation.busy) animation.cancel();
  }, [animation, state?.status]);
  const spinning = state?.status === 'spinning';
  const completed = state?.status === 'completed' || state?.status === 'pending_claim';
  const pending = state?.status === 'pending_claim' ? state.outcome : null;
  const claimOutcome = pending ?? (state?.status === 'completed' && (claims.saving || claims.confirmed?.id === state.outcome.id) ? state.outcome : null);
  const showClaim = claimOutcome && dismissedClaim !== claimOutcome.id && popup !== 'rules';
  const instagramRequired = !state || state.status === 'instagram_required';
  const canConfirm = !!state && state.instagramOpenedAt !== null && !error;

  async function spin() {
    if (starting || animation.busy || error || claims.checking || claims.error || state?.status !== 'ready') return;
    setStarting(true);
    try {
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : gameConfig.spin.durationMs;
      const outcome = await store.startSpin(duration + gameConfig.spin.revealDelayMs);
      if (!outcome || !mounted.current) return;
      animation.start(outcome.rotation, duration, gameConfig.spin.revealDelayMs, () => store.finishSpin(outcome.id));
    } finally { setStarting(false); }
  }

  async function confirmInstagram() {
    const next = await store.confirmInstagram();
    if (next?.status === 'ready') setPopup(null);
  }

  return (
    <ViewportGate>
      {error && <p className="storage-error" role="alert">{t('storageError')}</p>}
      {claims.error && !showClaim && <p className="storage-error" role="alert">{t(claims.error)}</p>}
      {instagramRequired && (
        <Landing canConfirm={canConfirm} disabled={error || !state}
          onOpen={() => { setPopup('reminder'); void store.openInstagram(); }} onConfirm={() => { void confirmInstagram(); }} />
      )}
      {instagramRequired && popup === 'reminder' && (
        <Dialog title={t('reminderTitle')} className="reminder-dialog" onClose={() => setPopup(null)}>
          <img src="/assets/attention.png" alt="" width="180" height="158" />
          <p>{t('reminderMessage')}</p>
          <button className="primary-button" type="button" disabled={!canConfirm} onClick={() => { void confirmInstagram(); }}>
            {t('confirmInstagram')}
          </button>
        </Dialog>
      )}
      {!instagramRequired && state?.status !== 'cooldown' && (
        <section className="wheel-screen" aria-labelledby="game-title">
          <h1 id="game-title" className="sr-only">{t('appTitle')}</h1>
          {completed && <div className="completed-notice" role="status">
            <p>{t(pending ? 'pendingClaimMessage' : 'completedMessage')}</p>
            {pending && <button type="button" onClick={() => { setDismissedClaim(null); setPopup(null); }}>{t('showPrize')}</button>}
          </div>}
          <div className="wheel-layout">
            <button className="primary-button spin-button" type="button" disabled={completed || spinning || starting || error || claims.checking || !!claims.error}
              aria-busy={spinning || starting} onClick={() => { void spin(); }}>
              {t(completed ? 'alreadyPlayed' : 'spinButton')}
            </button>
            <Wheel segments={gameConfig.segments} disabled={completed} rotorRef={attachRotor} />
            {spinning && <p className="sr-only" role="status">{t('spinningStatus')}</p>}
          </div>
        </section>
      )}
      {state?.status === 'cooldown' && <LosingScreen until={state.cooldownUntil} />}
      <footer className="game-footer">
        <button type="button" onClick={() => setPopup('rules')}>{t('gameRules')}</button>
      </footer>
      {showClaim && (
        <WinningDialog prize={claimOutcome.segment} confirmed={state?.status === 'completed'}
          busy={claims.saving || claims.checking} disabled={error} error={claims.error} onSubmit={claims.submit}
          onClose={() => { setDismissedClaim(claimOutcome.id); setPopup(null); }} />
      )}
      {popup === 'rules' && (
        <Dialog title={t('gameRules')} className="rules-dialog" onClose={() => setPopup(null)}>
          <p className="rules-intro">{t('rulesIntro')}</p>
          <ol className="rules-list">
            <li>{t('rulesSubscribe')}</li>
            <li>{t('rulesSpin')}</li>
            <li>{t('rulesClaim')}</li>
          </ol>
          <p className="form-note">{t('rulesPreviewNotice')}</p>
          <button className="primary-button" type="button" onClick={() => setPopup(null)}>{t('understood')}</button>
        </Dialog>
      )}
      {languageOpen && <LanguageDialog onClose={onLanguageClose} />}
    </ViewportGate>
  );
}
