import { useTranslation } from 'react-i18next';
import { INSTAGRAM_URL } from '../game/participation';

interface LandingProps {
  canConfirm: boolean;
  disabled: boolean;
  onOpen: () => void;
  onConfirm: () => void;
}

export function Landing({ canConfirm, disabled, onOpen, onConfirm }: LandingProps) {
  const { t } = useTranslation();
  return (
    <section className="drawer subscription-drawer" aria-labelledby="landing-title">
      <h1 id="landing-title" className="sr-only">{t('landingTitle')}</h1>
      <ol className="subscription-steps">
        <li>{t('subscribeStepOne')}</li>
        <li>{t('subscribeStepTwo')}</li>
        <li>{t('subscribeStepThree')}</li>
      </ol>
      <a className="primary-button instagram-button" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer"
        aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); else onOpen(); }}>
        {t('subscribeButton')}
      </a>
      <button className="instagram-confirm" type="button" disabled={!canConfirm} onClick={onConfirm}>{t('confirmInstagram')}</button>
    </section>
  );
}
