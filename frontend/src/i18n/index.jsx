import React, { createContext, useContext, useEffect, useMemo } from 'react';
import en from './en';
import tr from './tr';
import es from './es';
import ptBR from './pt-BR';
import ru from './ru';
import de from './de';
import fr from './fr';
import zhCN from './zh-CN';
import ar from './ar';
import hi from './hi';
import id from './id';
import vi from './vi';
import ja from './ja';
import ko from './ko';

const dictionaries = {
  en, tr, es, 'pt-BR': ptBR, ru, de, fr, 'zh-CN': zhCN, ar, hi, id, vi, ja, ko
};
export const SUPPORTED_LANGS = Object.keys(dictionaries);

// Sağdan sola yazılan diller (document.dir için)
export const RTL_LANGS = ['ar'];

// 'pt' gibi taban kodları desteklenen bölgesel koda eşle
const BASE_LANG_MAP = { pt: 'pt-BR', zh: 'zh-CN' };

// Resolve the effective UI language.
// pref: 'auto' | supported lang code  ('auto' = follow the OS/browser language, English fallback)
export function resolveLanguage(pref) {
  if (SUPPORTED_LANGS.includes(pref)) return pref;
  const nav = String((typeof navigator !== 'undefined' && navigator.language) || 'en');
  // Tam eşleşme dene (ör. pt-BR, zh-CN) — büyük/küçük harf duyarsız
  const exact = SUPPORTED_LANGS.find(l => l.toLowerCase() === nav.toLowerCase());
  if (exact) return exact;
  // Taban dil eşleşmesi (ör. 'de-AT' → 'de', 'pt-PT' → 'pt-BR')
  const base = nav.toLowerCase().split('-')[0];
  if (SUPPORTED_LANGS.includes(base)) return base;
  if (BASE_LANG_MAP[base]) return BASE_LANG_MAP[base];
  return 'en';
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
    document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
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
