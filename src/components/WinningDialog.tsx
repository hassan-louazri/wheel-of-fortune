import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, WheelSegment } from '../config/schema';
import type { ClaimErrorCode } from '../claims/claim';
import { validateEmail } from '../claims/email';
import { Dialog } from './Dialog';

export function WinningDialog({ prize, confirmed, busy, disabled, error, onSubmit, onClose }: {
  prize: WheelSegment;
  confirmed: boolean;
  busy: boolean;
  disabled: boolean;
  error: ClaimErrorCode | null;
  onSubmit: (email: string, language: Language) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const language = i18n.language === 'en' ? 'en' : 'fr';
  const message = invalid ? 'emailInvalid' : error;

  async function submit() {
    if (submitting.current || busy || disabled) return;
    const normalized = validateEmail(email);
    if (!normalized) { setInvalid(true); input.current?.focus(); return; }
    setInvalid(false);
    submitting.current = true;
    try { await onSubmit(normalized, language); }
    finally { submitting.current = false; }
  }

  return (
    <Dialog className="drawer-dialog winning-dialog" title={t(confirmed ? 'claimConfirmedTitle' : 'winTitle')} onClose={onClose}>
      {confirmed ? (
        <div className="claim-confirmation" role="status">
          <span className="confirmation-mark" aria-hidden="true">✓</span>
          <h3>{t('claimConfirmedHeading')}</h3>
          <p>{t('claimConfirmedDescription')}</p>
          <p className="form-note">{t('claimLocalNotice')}</p>
          <button className="primary-button" type="button" autoFocus onClick={onClose}>{t('done')}</button>
        </div>
      ) : (
        <>
          <div className="prize-art"><img src="/assets/prize.svg" width="150" height="150" alt="" /></div>
          <h3 className="prize-name">{prize.label[language]}</h3>
          <p className="prize-description">{t('prizeDescription')}</p>
          <form className="claim-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-busy={busy}>
            <label htmlFor="claim-email">{t('emailLabel')}</label>
            <input ref={input} id="claim-email" name="email" type="email" autoComplete="email" inputMode="email"
              required maxLength={254} disabled={busy || disabled} value={email}
              onChange={(event) => { setEmail(event.currentTarget.value); setInvalid(false); }}
              placeholder={t('emailPlaceholder')} aria-invalid={invalid} aria-describedby={`email-notice${message ? ' claim-error' : ''}`} />
            <p id="email-notice" className="form-note">{t('privacyNotice')}{' '}
              <a href={`${import.meta.env.BASE_URL}privacy/${language}.html`} target="_blank" rel="noopener noreferrer">{t('privacyPolicy')}</a>
            </p>
            {message && <p id="claim-error" className="claim-error" role="alert">{t(message)}</p>}
            <button className="primary-button claim-button" type="submit" disabled={busy || disabled}>
              {t(busy ? 'claimSaving' : 'claimPrize')}
            </button>
          </form>
        </>
      )}
    </Dialog>
  );
}
