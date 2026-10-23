import { afterEach, describe, expect, it, vi } from 'vitest';
import en from './en.json';
import fr from './fr.json';
import { LANGUAGE_STORAGE_KEY, readLanguage, saveLanguage } from './language';

afterEach(() => vi.unstubAllGlobals());

describe('language preferences', () => {
  it.each([null, 'es', '', 'en-US'])('defaults to French for unsupported or missing values: %j', (saved) => {
    vi.stubGlobal('window', { localStorage: { getItem: () => saved } });
    expect(readLanguage()).toBe('fr');
  });

  it.each(['fr', 'en'])('restores and saves %s', (saved) => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: () => saved, setItem } });
    expect(readLanguage()).toBe(saved);
    saveLanguage(saved);
    expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, saved);
  });

  it('survives denied access to localStorage', () => {
    vi.stubGlobal('window', {
      get localStorage() { throw new Error('Storage denied'); },
    });
    expect(readLanguage()).toBe('fr');
    expect(() => saveLanguage('en')).not.toThrow();
  });

  it('survives storage write failures and ignores unsupported languages', () => {
    const setItem = vi.fn(() => { throw new Error('Storage full'); });
    vi.stubGlobal('window', { localStorage: { setItem } });
    expect(() => saveLanguage('en')).not.toThrow();
    saveLanguage('es');
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('ships the same non-empty translation keys in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    for (const text of [...Object.values(fr), ...Object.values(en)]) {
      expect(text.trim()).not.toBe('');
    }
  });
  it('preserves interpolation parameters in every translation', () => {
    for (const key of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(en[key].match(/\{\{\w+\}\}/g)?.sort()).toEqual(fr[key].match(/\{\{\w+\}\}/g)?.sort());
    }
  });
});
