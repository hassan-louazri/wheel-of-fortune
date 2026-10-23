import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { gameConfig } from '../config';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function getViewportMode() {
  if (window.innerWidth > gameConfig.maxViewportWidth) return 'desktop';
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

export function ViewportGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribe, getViewportMode);

  if (mode === 'portrait') return children;

  return (
    <section className="card" aria-labelledby="restriction-title">
      <h1 id="restriction-title">{t(mode === 'desktop' ? 'desktopTitle' : 'rotationTitle')}</h1>
      <p>{t(mode === 'desktop' ? 'desktopDescription' : 'rotationDescription', {
        maxWidth: gameConfig.maxViewportWidth,
      })}</p>
    </section>
  );
}
