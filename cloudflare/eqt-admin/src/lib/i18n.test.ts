import { describe, it, expect } from 'vitest';
import { translate } from './i18n';

describe('i18n translate function', () => {
  it('should translate known keys in zh', () => {
    expect(translate('nav.overview', undefined, 'zh')).toBe('系统概览');
    expect(translate('common.confirm', undefined, 'zh')).toBe('确认');
  });

  it('should translate known keys in en', () => {
    expect(translate('nav.overview', undefined, 'en')).toBe('Overview');
    expect(translate('common.confirm', undefined, 'en')).toBe('Confirm');
  });

  it('should interpolate template parameters', () => {
    expect(translate('pagination.page', { page: 2, maxPage: 10 }, 'zh')).toBe('第 2 / 10 页');
    expect(translate('pagination.page', { page: 2, maxPage: 10 }, 'en')).toBe('Page 2 / 10');
  });

  it('should gracefully fallback to zh if key missing in en', () => {
    // common.test_fallback_key is intentionally present only in zh.ts, not in en.ts
    expect(translate('common.test_fallback_key', undefined, 'en')).toBe('仅中文测试回退键');
  });

  it('should return raw key path if key is not found in any dictionary', () => {
    expect(translate('non.existent.key', undefined, 'zh')).toBe('non.existent.key');
    expect(translate('non.existent.key', undefined, 'en')).toBe('non.existent.key');
  });
});
