import { describe, it, expect } from 'vitest';
import {
  escapeCsvCell,
  buildCsvContent,
  buildTxtContent,
  formatLicensesToRows
} from './export';
import type { License } from './types';

describe('export utilities', () => {
  it('escapes CSV cells correctly', () => {
    expect(escapeCsvCell('simple')).toBe('"simple"');
    expect(escapeCsvCell('with,comma')).toBe('"with,comma"');
    expect(escapeCsvCell('with "quotes"')).toBe('"with ""quotes"""');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
    expect(escapeCsvCell(123)).toBe('"123"');
  });

  it('builds CSV content with UTF-8 BOM', () => {
    const headers = ['Code', 'Tier'];
    const rows = [['EQT-1', 'PLUS'], ['EQT-2', 'PRO']];
    const csv = buildCsvContent(headers, rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Code","Tier"');
    expect(csv).toContain('"EQT-1","PLUS"');
    expect(csv).toContain('"EQT-2","PRO"');
  });

  it('builds TXT lines', () => {
    const lines = ['EQT-PLUS-1', 'EQT-PLUS-2'];
    const txt = buildTxtContent(lines);
    expect(txt).toBe('EQT-PLUS-1\r\nEQT-PLUS-2');
  });

  it('formats licenses to rows correctly', () => {
    const mockLicenses: License[] = [
      {
        license_code: 'EQT-PLUS-2026-TEST',
        tier: 'PLUS',
        status: 'active',
        source: 'promo',
        max_devices: 2,
        active_devices_count: 0,
        expires_at: '2026-12-31T00:00:00Z',
        duration_days: 14,
        created_at: '2026-09-01T00:00:00Z',
        activations: []
      }
    ];

    const { headers, rows } = formatLicensesToRows(mockLicenses, {
      code: 'Code',
      tier: 'Tier',
      source: 'Source',
      status: 'Status',
      redemption: 'Redemption',
      activeDevices: 'Active',
      maxDevices: 'Max',
      expiresAt: 'Expires',
      durationDays: 'Duration',
      buyerEmail: 'Email',
      createdAt: 'Created',
      redeemedLabel: 'Redeemed',
      unredeemedLabel: 'Unredeemed',
      expiredUnredeemedLabel: 'Expired'
    });

    expect(headers.length).toBe(11);
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('EQT-PLUS-2026-TEST');
    expect(rows[0][1]).toBe('PLUS');
    expect(rows[0][2]).toBe('promo');
    expect(rows[0][4]).toBe('Unredeemed');
  });

  it('marks license as Redeemed if first_activated_at exists even with 0 active devices', () => {
    const mockLicenses: License[] = [
      {
        license_code: 'EQT-PROMO-UNBOUND',
        tier: 'PLUS',
        status: 'active',
        source: 'promo',
        max_devices: 2,
        active_devices_count: 0,
        first_activated_at: '2026-09-10T00:00:00Z',
        expires_at: '2026-09-01T00:00:00Z', // Past redeem-by date, but was activated
        duration_days: 14,
        created_at: '2026-08-01T00:00:00Z',
        activations: []
      }
    ];

    const { rows } = formatLicensesToRows(mockLicenses, {
      code: 'Code',
      tier: 'Tier',
      source: 'Source',
      status: 'Status',
      redemption: 'Redemption',
      activeDevices: 'Active',
      maxDevices: 'Max',
      expiresAt: 'Expires',
      durationDays: 'Duration',
      buyerEmail: 'Email',
      createdAt: 'Created',
      redeemedLabel: 'Redeemed',
      unredeemedLabel: 'Unredeemed',
      expiredUnredeemedLabel: 'Expired'
    });

    expect(rows[0][4]).toBe('Redeemed');
  });
});
