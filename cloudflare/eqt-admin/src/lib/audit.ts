import type { AdminAuditLog } from './types';

export function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function prettyDetails(raw: string | null): string {
  if (!raw) return '—';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** One-line summary for table; full JSON still in modal */
export function summarizeDetails(row: AdminAuditLog): string {
  const d = parseDetails(row.details_json);
  if (!d) return '—';
  switch (row.action) {
    case 'GENERATE':
      return [
        d.tier,
        d.max_devices != null ? `设备上限 ${d.max_devices}` : null,
        d.expires_at === 'LIFETIME' ? '永久' : d.expires_at ? `到期 ${d.expires_at}` : null,
        d.buyer_email ? `邮箱 ${d.buyer_email}` : null,
        d.email_sent === true ? '已发信' : d.send_email_requested ? '未发信' : null
      ]
        .filter(Boolean)
        .join(' · ');
    case 'REVOKE':
      return [
        d.previous_status ? `${d.previous_status}→revoked` : '→revoked',
        d.tier,
        d.active_devices_count != null ? `当时设备 ${d.active_devices_count}` : null,
        d.buyer_email ? String(d.buyer_email) : null
      ]
        .filter(Boolean)
        .join(' · ');
    case 'UNBIND':
      return [
        d.mode === 'clear_all' ? '全清' : '单台',
        d.license_code ? String(d.license_code) : null,
        d.unbound_count != null ? `解绑 ${d.unbound_count} 台` : null,
        d.counts_toward_user_quota === false ? '不计用户配额' : null
      ]
        .filter(Boolean)
        .join(' · ');
    case 'CLEAR_LOGS':
      return d.cleared_error_log_count != null
        ? `清空错误日志 ${d.cleared_error_log_count} 条`
        : '清空错误日志';
    case 'BLACKLIST_ADD':
      return [
        d.kind ? `封禁 ${d.kind}` : '添加黑名单',
        d.target ? String(d.target) : null,
        d.reason ? `原因: ${d.reason}` : null
      ]
        .filter(Boolean)
        .join(' · ');
    case 'BLACKLIST_REMOVE':
      return d.target_id ? `解封条目 #${d.target_id}` : '解除黑名单';
    default:
      return row.details_json && row.details_json.length > 60
        ? `${row.details_json.slice(0, 57)}…`
        : row.details_json || '—';
  }
}
