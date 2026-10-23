import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function Dialog({ title, className = '', onClose, children }: {
  title: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useTranslation();

  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={titleId} onClose={(event) => {
      // Strict Mode can deliver a cleanup close event after the dialog has reopened.
      if (!event.currentTarget.open) onClose();
    }}>
      <button className="close-button" aria-label={t('close')} onClick={onClose} type="button">×</button>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
