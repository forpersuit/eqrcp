import { writable, derived } from 'svelte/store';
import { zh } from './locales/zh';
import { en } from './locales/en';

export type SupportedLocale = 'zh' | 'en';

const dictionaries: Record<SupportedLocale, Record<string, any>> = {
  zh,
  en,
};

const INITIAL_LOCALE: SupportedLocale = 'zh';

export const currentLocale = writable<SupportedLocale>(INITIAL_LOCALE);

export function setLocale(locale: SupportedLocale): void {
  if (dictionaries[locale]) {
    currentLocale.set(locale);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('eqt_admin_lang', locale);
      } catch {}
    }
  }
}

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const keys = path.split('.');
  let current: any = obj;
  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export function translate(
  path: string,
  params?: Record<string, string | number>,
  locale: SupportedLocale = 'zh'
): string {
  const dict = dictionaries[locale];
  let val = dict ? getNestedValue(dict, path) : undefined;

  // Fallback to 'zh' dictionary if missing in target locale
  if (!val && locale !== 'zh') {
    val = getNestedValue(dictionaries.zh, path);
  }

  // Final fallback: return the key path itself
  if (!val) {
    return path;
  }

  // Template interpolation for {key}
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
