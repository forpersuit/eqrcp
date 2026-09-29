import type { License } from './types';

/**
 * Escape a CSV field value.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Build CSV string with UTF-8 BOM.
 */
export function buildCsvContent(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const bom = '\uFEFF';
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map(row => row.map(escapeCsvCell).join(','));
  return bom + [headerLine, ...rowLines].join('\r\n');
}

/**
 * Build text lines string.
 */
export function buildTxtContent(lines: string[]): string {
  return lines.join('\r\n');
}

/**
 * Trigger file download in browser using Blob and ObjectURL.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export table data to CSV file with UTF-8 BOM.
 */
export function exportToCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const csvContent = buildCsvContent(headers, rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

/**
 * Export pure text lines to TXT file (one line per entry).
 */
export function exportToTxt(filename: string, lines: string[]): void {
  const content = buildTxtContent(lines);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export interface LicenseCsvColumnLabels {
  code: string;
  tier: string;
  source: string;
  status: string;
  redemption: string;
  activeDevices: string;
  maxDevices: string;
  expiresAt: string;
  durationDays: string;
  buyerEmail: string;
  createdAt: string;
  redeemedLabel: string;
  unredeemedLabel: string;
  expiredUnredeemedLabel: string;
}

/**
 * Convert licenses list to CSV rows.
 */
export function formatLicensesToRows(
  licenses: License[],
  columnLabels: LicenseCsvColumnLabels
): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  const headers = [
    columnLabels.code,
    columnLabels.tier,
    columnLabels.source,
    columnLabels.status,
    columnLabels.redemption,
    columnLabels.activeDevices,
    columnLabels.maxDevices,
    columnLabels.expiresAt,
    columnLabels.durationDays,
    columnLabels.buyerEmail,
    columnLabels.createdAt
  ];

  const now = new Date();

  const rows = licenses.map(lic => {
    let redemption = columnLabels.unredeemedLabel;
    const isRedeemed = (lic.active_devices_count > 0) || Boolean(lic.first_activated_at);
    if (isRedeemed) {
      redemption = columnLabels.redeemedLabel;
    } else if (lic.expires_at && lic.expires_at !== 'LIFETIME' && new Date(lic.expires_at) <= now) {
      redemption = columnLabels.expiredUnredeemedLabel;
    }

    const expStr = lic.expires_at === 'LIFETIME'
      ? 'LIFETIME'
      : (lic.expires_at ? new Date(lic.expires_at).toLocaleString() : '');

    return [
      lic.license_code,
      lic.tier,
      lic.source || 'admin',
      lic.status,
      redemption,
      lic.active_devices_count,
      lic.max_devices,
      expStr,
      lic.duration_days ?? '',
      lic.buyer_email || lic.buyer_email_hash || '',
      lic.created_at ? new Date(lic.created_at).toLocaleString() : ''
    ];
  });

  return { headers, rows };
}

/**
 * Export a list of licenses to CSV.
 */
export function exportLicensesToCsv(
  filename: string,
  licenses: License[],
  columnLabels: LicenseCsvColumnLabels
): void {
  const { headers, rows } = formatLicensesToRows(licenses, columnLabels);
  exportToCsv(filename, headers, rows);
}
