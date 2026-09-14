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

  it('should have complete parity for all new TLS and health probe keys in zh and en', () => {
    const keysToCheck = [
      'tls.autoRefreshTitle',
      'tls.totalAttemptsSub',
      'tls.avgDurationSub',
      'tls.attributionHint',
      'tls.nodeIdRequired',
      'tls.nodeIdInvalid',
      'tls.ipRequired',
      'tls.ipInvalid',
      'tls.confirmTarget',
      'tls.confirmKey',
      'health.probeTlsTitle',
      'health.probeTlsClosed',
      'health.probeTlsHalfOpen',
      'health.probeTlsOpen'
    ];

    for (const key of keysToCheck) {
      const zhVal = translate(key, undefined, 'zh');
      const enVal = translate(key, undefined, 'en');
      expect(zhVal).not.toBe(key);
      expect(enVal).not.toBe(key);
      expect(zhVal).not.toBe(enVal);
    }

    const descZh = translate('health.probeTlsDesc', { state: 'CLOSED', success: 5, failure: 0 }, 'zh');
    const descEn = translate('health.probeTlsDesc', { state: 'CLOSED', success: 5, failure: 0 }, 'en');
    expect(descZh).toContain('状态: CLOSED · 连续成功: 5 · 连续失败: 0');
    expect(descEn).toContain('State: CLOSED · Successes: 5 · Failures: 0');
  });
});
