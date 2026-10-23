import { useEffect, useState } from 'react';
import { countdown } from '../game/participation';
import { useTranslation } from 'react-i18next';

export function LosingScreen({ until }: { until: number }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = countdown(until, now);
  const display = [remaining.hours, remaining.minutes, remaining.seconds].map((value) => String(value).padStart(2, '0')).join(' : ');
  return (
    <div className="loss-screen">
      <section className="drawer loss-drawer" aria-labelledby="loss-title">
        <h1 id="loss-title">{t('lossTitle')}</h1>
        {i18n.language === 'fr' ? <img className="loss-art" src="/assets/loss.png" width="200" height="200" alt="" /> : (
          <div className="loss-art loss-art-english" aria-hidden="true"><span>{t('lossArtwork')}</span></div>
        )}
        <p className="loss-message">{t('lossMessage')}</p>
        <div className="countdown">
          <p>{t('nextParticipation')}</p>
          <time aria-label={t('countdownLabel', remaining)} dateTime={`PT${remaining.total}S`}>{display}</time>
        </div>
      </section>
    </div>
  );
}
