import { state } from '../state.js';
import { en } from './en';
import { zh } from './zh';
import { ja } from './ja';
import { ko } from './ko';
import { es } from './es';
import { de } from './de';
import { fr } from './fr';
import type { SupportedLocale, TranslationSchema, TranslationKey } from './types';

const rawTranslations: Record<SupportedLocale, TranslationSchema> = {
    zh,
    en,
    ja,
    ko,
    es,
    de,
    fr,
};

// 安全合体兜底：优先 target 语言，缺漏回退至 en 和 zh
export const translations: Record<SupportedLocale, TranslationSchema> = Object.fromEntries(
    Object.entries(rawTranslations).map(([lang, dict]) => [
        lang,
        { ...en, ...zh, ...dict },
    ])
) as Record<SupportedLocale, TranslationSchema>;

export function getSystemLocale(): SupportedLocale {
    const sysLang = (navigator.language || 'en').toLowerCase();
    if (sysLang.startsWith('zh')) return 'zh';
    if (sysLang.startsWith('ja')) return 'ja';
    if (sysLang.startsWith('ko')) return 'ko';
    if (sysLang.startsWith('es')) return 'es';
    if (sysLang.startsWith('de')) return 'de';
    if (sysLang.startsWith('fr')) return 'fr';
    return 'en';
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
    const lang = (state && state.settings && (state.settings.lang as SupportedLocale)) || getSystemLocale();
    const dict = translations[lang] || translations['en'] || translations['zh'];
    let val: string = (dict && dict[key]) || (translations['en'] && translations['en'][key]) || (translations['zh'] && translations['zh'][key]) || String(key);
    
    if (params) {
        for (const k in params) {
            val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
        }
    }
    return val;
}

export type { SupportedLocale, TranslationSchema, TranslationKey };
