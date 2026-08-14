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

export type TranslateFunction = (path: string, params?: Record<string, string | number>) => string;

/** One-line summary for table; full JSON still in modal */
export function summarizeDetails(row: AdminAuditLog, tFn?: TranslateFunction): string {
  const d = parseDetails(row.details_json);
  const tr = tFn || ((key: string, params?: Record<string, string | number>) => {
    if (key === 'audit.summary.maxDevices') return `设备上限 ${params?.count}`;
    if (key === 'audit.summary.lifetime') return '永久';
    if (key === 'audit.summary.expiresAt') return `到期 ${params?.date}`;
    if (key === 'audit.summary.email') return `邮箱 ${params?.email}`;
    if (key === 'audit.summary.emailSent') return '已发信';
    if (key === 'audit.summary.emailNotSent') return '未发信';
    if (key === 'audit.summary.revokedFrom') return `${params?.from}→已吊销`;
    if (key === 'audit.summary.revokedTo') return '→已吊销';
    if (key === 'audit.summary.activeDevicesCount') return `当时设备 ${params?.count}`;
    if (key === 'audit.summary.modeAll') return '全清';
    if (key === 'audit.summary.modeSingle') return '单台';
    if (key === 'audit.summary.unboundCount') return `解绑 ${params?.count} 台`;
    if (key === 'audit.summary.noUserQuotaDeduction') return '不计用户配额';
    if (key === 'audit.summary.clearedErrorLogs') return `清空错误日志 ${params?.count} 条`;
    if (key === 'audit.summary.clearLogsDefault') return '清空错误日志';
    if (key === 'audit.summary.blacklistBanKind') return `封禁 ${params?.kind}`;
    if (key === 'audit.summary.blacklistAddDefault') return '添加黑名单';
    if (key === 'audit.summary.blacklistUnbanEntry') return `解封条目 #${params?.id}`;
    if (key === 'audit.summary.blacklistRemoveDefault') return '解除黑名单';
    if (key === 'audit.summary.queryLocations') return `点位分布 (${params?.devices} 台 / ${params?.countries} 国 / ${params?.arcs} 弧线)`;
    if (key === 'audit.summary.queryLiveDevices') return `活跃设备 [${params?.window}] (${params?.devices} 台 / 付费 ${params?.paid} / 免费 ${params?.free})`;
    if (key === 'audit.summary.pruneSummary') return `裁剪日志 (错误日志 ${params?.errorLogs} 条 / 审计日志 ${params?.auditLogs} 条)`;
    if (key === 'audit.summary.reasonPrefix') return `原因: ${params?.reason}`;
    return key;
  });

  if (!d) return '—';
  switch (row.action) {
    case 'GENERATE':
      return [
        d.tier ? String(d.tier) : null,
        d.max_devices != null ? tr('audit.summary.maxDevices', { count: Number(d.max_devices) }) : null,
        d.expires_at === 'LIFETIME' ? tr('audit.summary.lifetime') : d.expires_at ? tr('audit.summary.expiresAt', { date: String(d.expires_at) }) : null,
        d.buyer_email ? tr('audit.summary.email', { email: String(d.buyer_email) }) : null,
        d.email_sent === true ? tr('audit.summary.emailSent') : d.send_email_requested ? tr('audit.summary.emailNotSent') : null
      ]
        .filter(Boolean)
        .join(' · ');

    case 'REVOKE':
      return [
        d.previous_status
          ? tr('audit.summary.revokedFrom', { from: String(d.previous_status) })
          : tr('audit.summary.revokedTo'),
        d.tier ? String(d.tier) : null,
        d.active_devices_count != null ? tr('audit.summary.activeDevicesCount', { count: Number(d.active_devices_count) }) : null,
        d.buyer_email ? String(d.buyer_email) : null
      ]
        .filter(Boolean)
        .join(' · ');

    case 'UNBIND':
      return [
        d.mode === 'clear_all' ? tr('audit.summary.modeAll') : tr('audit.summary.modeSingle'),
        d.license_code ? String(d.license_code) : null,
        d.unbound_count != null ? tr('audit.summary.unboundCount', { count: Number(d.unbound_count) }) : null,
        d.counts_toward_user_quota === false ? tr('audit.summary.noUserQuotaDeduction') : null
      ]
        .filter(Boolean)
        .join(' · ');

    case 'CLEAR_LOGS':
      return d.cleared_error_log_count != null
        ? tr('audit.summary.clearedErrorLogs', { count: Number(d.cleared_error_log_count) })
        : tr('audit.summary.clearLogsDefault');

    case 'QUERY_ACTIVATION_LOCATIONS':
      return tr('audit.summary.queryLocations', {
        devices: Number(d.total_active_devices || 0),
        countries: Number(d.active_country_count || 0),
        arcs: Number(d.cross_region_arcs_count || 0)
      });

    case 'QUERY_LIVE_DEVICES':
      return tr('audit.summary.queryLiveDevices', {
        window: String(d.window || '1h'),
        devices: Number(d.total_active_devices || 0),
        paid: Number(d.total_paid_devices || 0),
        free: Number(d.total_free_devices || 0)
      });

    case 'PRUNE':
      return tr('audit.summary.pruneSummary', {
        errorLogs: Number(d.deleted_error_logs || 0),
        auditLogs: Number(d.deleted_audit_logs || 0)
      });

    case 'BLACKLIST_ADD': {
      const target = d.email || d.device_id || d.target || (row.target_id ? `#${row.target_id}` : null);
      return [
        d.kind ? tr('audit.summary.blacklistBanKind', { kind: String(d.kind) }) : tr('audit.summary.blacklistAddDefault'),
        target ? String(target) : null,
        d.reason ? tr('audit.summary.reasonPrefix', { reason: String(d.reason) }) : null
      ]
        .filter(Boolean)
        .join(' · ');
    }

    case 'BLACKLIST_REMOVE': {
      const targetId = row.target_id || (d.target_id as string | number | undefined);
      const targetIdentity = d.email || d.device_id;
      if (targetId) {
        const base = tr('audit.summary.blacklistUnbanEntry', { id: targetId });
        return targetIdentity ? `${base} (${targetIdentity})` : base;
      }
      return targetIdentity ? `${tr('audit.summary.blacklistRemoveDefault')} (${targetIdentity})` : tr('audit.summary.blacklistRemoveDefault');
    }

    default:
      return row.details_json && row.details_json.length > 60
        ? `${row.details_json.slice(0, 57)}…`
        : row.details_json || '—';
  }
}
