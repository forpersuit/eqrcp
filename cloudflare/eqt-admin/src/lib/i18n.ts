import { writable, derived } from 'svelte/store';
import { zh } from './locales/zh';

export type SupportedLocale = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'de' | 'fr';

const dictionaries: Record<SupportedLocale, Record<string, any>> = {
  zh: zh,
  en: {}, // Extensible for future language packs
  ja: {},
  ko: {},
  es: {},
  de: {},
  fr: {}
};

const INITIAL_LOCALE: SupportedLocale = 'zh';

export const currentLocale = writable<SupportedLocale>(INITIAL_LOCALE);

export function setLocale(locale: SupportedLocale) {
  if (dictionaries[locale]) {
    currentLocale.set(locale);
    if (typeof window !== 'undefined') {
      localStorage.setItem('eqt_admin_lang', locale);
    }
  }
}

function getNestedValue(obj: any, path: string): string | undefined {
  const keys = path.split('.');
  let current = obj;
  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export function translate(path: string, params?: Record<string, string | number>, locale: SupportedLocale = 'zh'): string {
  const dict = dictionaries[locale] || dictionaries.zh;
  let val = getNestedValue(dict, path);
  
  // Graceful fallback to 'zh' dictionary if missing in target locale
  if (!val && locale !== 'zh') {
    val = getNestedValue(dictionaries.zh, path);
  }
  
  // Ultimate fallback to key path
  if (!val) {
    return path;
  }

  // Template interpolation for {var}
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      val = val!.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }

  return val;
}

export const t = derived(currentLocale, ($locale) => {
  return (path: string, params?: Record<string, string | number>) => translate(path, params, $locale);
});
