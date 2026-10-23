import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import fr from './fr.json';
import { readLanguage, saveLanguage } from './language';

i18n.on('languageChanged', (language) => {
  saveLanguage(language);
  document.documentElement.lang = language;
  document.title = i18n.t('appTitle');
});

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en satisfies typeof fr },
  },
  lng: readLanguage(),
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  initAsync: false,
  interpolation: { escapeValue: false },
});

export default i18n;
