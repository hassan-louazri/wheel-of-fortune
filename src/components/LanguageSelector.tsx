import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';

export function LanguageSelector({ onOpen }: { onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="language-controls">
      <button className="language-icon" aria-label={t('translationOptions')} onClick={onOpen} type="button">
        <img src="/assets/language.svg" width="24" height="24" alt="" />
      </button>
      <label className="language-picker">
        <span className="sr-only">{t('languageLabel')}</span>
        <select value={i18n.language} onChange={(event) => {
          const language = event.currentTarget.value;
          if (language === 'fr' || language === 'en') void i18n.changeLanguage(language);
        }}>
          <option value="fr" lang="fr">{t('languageFrench')}</option>
          <option value="en" lang="en">{t('languageEnglish')}</option>
        </select>
      </label>
    </div>
  );
}

export function LanguageDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog title={t('chooseLanguage')} className="language-dialog" onClose={onClose}>
      <img className="translation-art" src="/assets/language.svg" alt="" width="64" height="64" />
      <div className="language-options" role="group" aria-label={t('languageLabel')}>
        {(['fr', 'en'] as const).map((language) => (
          <button key={language} type="button" className="language-option" lang={language}
            aria-pressed={i18n.language === language} onClick={() => { void i18n.changeLanguage(language); }}>
            <span className={`flag flag-${language}`} aria-hidden="true" />
            {t(language === 'fr' ? 'languageFrench' : 'languageEnglish')}
          </button>
        ))}
      </div>
      <button className="primary-button" onClick={onClose} type="button">{t('validate')}</button>
    </Dialog>
  );
}
