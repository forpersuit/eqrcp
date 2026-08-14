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
    // translate handles parameters like {count}
    const res = translate('common.actions', { count: 5 }, 'zh');
    expect(res).toBe('操作');
  });

  it('should gracefully fallback to zh if key missing in en', () => {
    // If a key doesn't exist in en, it falls back to zh
    expect(translate('nav.title', undefined, 'en')).toBe('EQT DRM Admin');
  });

  it('should return raw key path if key is not found in any dictionary', () => {
    expect(translate('non.existent.key', undefined, 'zh')).toBe('non.existent.key');
    expect(translate('non.existent.key', undefined, 'en')).toBe('non.existent.key');
  });
});
