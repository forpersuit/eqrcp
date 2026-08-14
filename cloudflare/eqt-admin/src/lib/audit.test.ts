import { describe, it, expect } from 'vitest';
import { parseDetails, prettyDetails, summarizeDetails } from './audit';
import type { AdminAuditLog } from './types';

describe('audit helpers', () => {
  it('parseDetails should parse valid json string', () => {
    expect(parseDetails('{"tier":"PRO","max_devices":5}')).toEqual({
      tier: 'PRO',
      max_devices: 5,
    });
    expect(parseDetails(null)).toBeNull();
    expect(parseDetails('invalid-json')).toBeNull();
  });

  it('prettyDetails should format json string', () => {
    expect(prettyDetails(null)).toBe('—');
    expect(prettyDetails('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('summarizeDetails should format GENERATE action', () => {
    const row: AdminAuditLog = {
      id: 1,
      action: 'GENERATE',
      target_type: 'LICENSE',
      target_id: 'EQT-123',
      details_json: JSON.stringify({
        tier: 'PRO',
        max_devices: 3,
        expires_at: 'LIFETIME',
        buyer_email: 'buyer@example.com',
        email_sent: true,
      }),
      operator_ip: '1.2.3.4',
      created_at: '2026-08-14T00:00:00Z',
    };
    expect(summarizeDetails(row)).toBe('PRO · 设备上限 3 · 永久 · 邮箱 buyer@example.com · 已发信');
  });

  it('summarizeDetails should format REVOKE action', () => {
    const row: AdminAuditLog = {
      id: 2,
      action: 'REVOKE',
      target_type: 'LICENSE',
      target_id: 'EQT-123',
      details_json: JSON.stringify({
        previous_status: 'active',
        tier: 'PLUS',
        active_devices_count: 2,
        buyer_email: 'test@example.com',
      }),
      operator_ip: '1.2.3.4',
      created_at: '2026-08-14T00:00:00Z',
    };
    expect(summarizeDetails(row)).toBe('active→revoked · PLUS · 当时设备 2 · test@example.com');
  });

  it('summarizeDetails should format UNBIND and CLEAR_LOGS', () => {
    const unbindRow: AdminAuditLog = {
      id: 3,
      action: 'UNBIND',
      target_type: 'ACTIVATION',
      target_id: '10',
      details_json: JSON.stringify({
        mode: 'clear_all',
        license_code: 'EQT-999',
        unbound_count: 3,
      }),
      operator_ip: '1.2.3.4',
      created_at: '2026-08-14T00:00:00Z',
    };
    expect(summarizeDetails(unbindRow)).toBe('全清 · EQT-999 · 解绑 3 台');

    const clearRow: AdminAuditLog = {
      id: 4,
      action: 'CLEAR_LOGS',
      target_type: 'SYSTEM',
      target_id: null,
      details_json: JSON.stringify({ cleared_error_log_count: 42 }),
      operator_ip: '1.2.3.4',
      created_at: '2026-08-14T00:00:00Z',
    };
    expect(summarizeDetails(clearRow)).toBe('清空错误日志 42 条');
  });
});
