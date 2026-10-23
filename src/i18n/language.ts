import { gameConfig } from '../config';
import type { Language } from '../config/schema';

export const LANGUAGE_STORAGE_KEY = 'wheel-of-fortune.language';

export function readLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    // Blocked storage must not prevent the app from opening.
  }
  return gameConfig.defaultLanguage;
}

export function saveLanguage(language: string): void {
  if (language !== 'fr' && language !== 'en') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The selected language still works for this visit without storage.
  }
}
