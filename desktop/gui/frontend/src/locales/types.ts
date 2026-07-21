import type { en } from './en';

export type SupportedLocale = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'de' | 'fr';

export type TranslationSchema = typeof en;

export type TranslationKey = keyof TranslationSchema;
