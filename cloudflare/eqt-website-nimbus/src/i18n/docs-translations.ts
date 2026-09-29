import { withBase } from "@cloudflare/nimbus-docs/runtime";

export const SUPPORTED_LANGS = ["zh", "en", "fr", "ja", "ko", "de", "es"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: SupportedLang = "zh";

export interface LanguageMeta {
  code: SupportedLang;
  label: string;
}

export const LANGUAGES_META: LanguageMeta[] = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];

export const NAV_TITLES: Record<SupportedLang, string> = {
  zh: "导航目录",
  en: "Navigation",
  fr: "Navigation",
  ja: "ナビゲーション",
  ko: "내비게이션",
  de: "Navigation",
  es: "Navegación",
};

export const FILTER_PLACEHOLDERS: Record<SupportedLang, string> = {
  zh: "筛选目录…",
  en: "Filter…",
  fr: "Filtrer…",
  ja: "フィルター…",
  ko: "필터…",
  de: "Filtern…",
  es: "Filtrar…",
};

export const CLOSE_LABELS: Record<SupportedLang, string> = {
  zh: "关闭侧边栏",
  en: "Close sidebar",
  fr: "Fermer la barre latérale",
  ja: "サイドバーを閉じる",
  ko: "사이드바 닫기",
  de: "Seitenleiste schließen",
  es: "Cerrar barra lateral",
};

export const EDIT_PAGE_LABELS: Record<SupportedLang, string> = {
  zh: "在 GitHub 上编辑此页",
  en: "Edit this page",
  fr: "Modifier cette page",
  ja: "このページを編集",
  ko: "이 페이지 편집",
  de: "Diese Seite bearbeiten",
  es: "Editar esta página",
};

export const PREV_LABELS: Record<SupportedLang, string> = {
  zh: "上一页",
  en: "Previous",
  fr: "Précédent",
  ja: "前へ",
  ko: "이전",
  de: "Zurück",
  es: "Anterior",
};

export const NEXT_LABELS: Record<SupportedLang, string> = {
  zh: "下一页",
  en: "Next",
  fr: "Suivant",
  ja: "次へ",
  ko: "다음",
  de: "Weiter",
  es: "Siguiente",
};

export const BREADCRUMB_HOME_LABELS: Record<SupportedLang, string> = {
  zh: "首页",
  en: "Home",
  fr: "Accueil",
  ja: "ホーム",
  ko: "홈",
  de: "Startseite",
  es: "Inicio",
};

export const SITE_TITLE_MAP: Record<SupportedLang, string> = {
  zh: "EQT 技术文档",
  en: "EQT Documentation",
  fr: "Documentation EQT",
  ja: "EQT ドキュメント",
  ko: "EQT 기술 문서",
  de: "EQT Dokumentation",
  es: "Documentación EQT",
};

export function isSupportedLang(lang: string): lang is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

export function resolveLang(pathname?: string, entryId?: string): SupportedLang {
  const p = pathname || "";
  for (const lang of SUPPORTED_LANGS) {
    if (
      p.startsWith(`/${lang}/`) ||
      p === `/${lang}` ||
      p.startsWith(`${lang}/`) ||
      p === lang ||
      (entryId && (entryId.startsWith(`${lang}/`) || entryId === lang))
    ) {
      return lang;
    }
  }
  return DEFAULT_LANG;
}

export function itemBelongsToLang(item: any, lang: string): boolean {
  if (!item) return false;
  const href = item.href || item.indexHref || item._routeKey || "";
  if (typeof href === "string" && href) {
    if (
      href.startsWith(`/${lang}/`) ||
      href === `/${lang}` ||
      href.startsWith(`${lang}/`) ||
      href === lang
    ) {
      return true;
    }
  }
  if (Array.isArray(item.children)) {
    return item.children.some((child: any) => itemBelongsToLang(child, lang));
  }
  return false;
}

export function resolveLangHref(
  pathname: string,
  currentLang: SupportedLang,
  targetLang: SupportedLang,
  baseUrl: string = import.meta.env.BASE_URL
): string {
  if (currentLang === targetLang) return pathname;
  const regexWithSlash = new RegExp(`/${currentLang}/`);
  if (regexWithSlash.test(pathname)) {
    return pathname.replace(regexWithSlash, `/${targetLang}/`);
  }
  const regexEnd = new RegExp(`/${currentLang}$`);
  if (regexEnd.test(pathname)) {
    return withBase(`/${targetLang}/intro`, baseUrl);
  }
  return withBase(`/${targetLang}/intro`, baseUrl);
}
