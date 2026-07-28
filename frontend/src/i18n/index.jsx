import React, { createContext, useContext, useEffect, useMemo } from 'react';
import en from './en';
import tr from './tr';

const dictionaries = { en, tr };
export const SUPPORTED_LANGS = ['en', 'tr'];

// Resolve the effective UI language.
// pref: 'auto' | 'tr' | 'en'  ('auto' = follow the OS/browser language, English fallback)
export function resolveLanguage(pref) {
  if (SUPPORTED_LANGS.includes(pref)) return pref;
  const nav = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase();
  return nav.startsWith('tr') ? 'tr' : 'en';
}

const I18nContext = createContext({
  lang: 'en',
  t: (key) => key
});

// React'siz ortamlarda (event handler'lar, Electron'a yakın kod) çeviri için
// bağımsız yardımcı — context gerektirmez.
export function translate(langOrPref, key, vars) {
  const lang = resolveLanguage(langOrPref);
  const dict = dictionaries[lang] || dictionaries.en;
  let s = dict[key];
  if (s === undefined) s = dictionaries.en[key];
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split('{' + k + '}').join(String(v));
    }
  }
  return s;
}

// GitHub release gövdesi iki dilli markdown'dır ("## What's New" --- "## Yenilikler").
// UI diline uyan bölümü seçip markdown işaretlerini temizleyerek düz madde listesi döndürür.
export function formatReleaseNotes(raw, lang) {
  if (!raw) return [];
  // GitHub API gövdesi \r\n satır sonları içerir; ayırıcı regex'i için normalize et.
  const normalized = String(raw).replace(/\r\n/g, '\n');
  const sections = normalized.split(/\n-{3,}\n/);
  let section = sections[0];
  const wanted = lang === 'tr' ? /yenilikler/i : /what's new/i;
  for (const s of sections) {
    if (wanted.test(s)) { section = s; break; }
  }
  return section
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.replace(/^[-*]\s+/, ''));
}

export function I18nProvider({ languagePref, children }) {
  const lang = resolveLanguage(languagePref);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    const dict = dictionaries[lang] || dictionaries.en;
    const t = (key, vars) => {
      let s = dict[key];
      if (s === undefined) s = dictionaries.en[key];
      if (s === undefined) return key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split('{' + k + '}').join(String(v));
        }
      }
      return s;
    };
    return { lang, t };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
