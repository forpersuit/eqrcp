#!/usr/bin/env bash
# ==============================================================================
# Script: sync-certs-from-vps.sh
# Purpose: Synchronize official Let's Encrypt wildcard certificates from VPS
#          Node 1 (ns1.eqt.net.im) to the local desktop client certificate cache.
#          Supports Linux, WSL2, and Windows host sync.
# ==============================================================================
set -euo pipefail

VPS_HOST="${EQT_VPS_HOST:-128.241.227.181}"
VPS_USER="${EQT_VPS_USER:-root}"
VPS_CERT_DIR="/etc/letsencrypt/live/direct.eqt.net.im"
LOCAL_CERT_DIR="${HOME}/.config/eqt/certs"

echo "=== [EQT] Syncing Wildcard Certificates from VPS ==="
echo "Source: ${VPS_USER}@${VPS_HOST}:${VPS_CERT_DIR}"
echo "Target: ${LOCAL_CERT_DIR}"

mkdir -p "${LOCAL_CERT_DIR}"

# Pull certificates via secure scp / ssh
scp "${VPS_USER}@${VPS_HOST}:${VPS_CERT_DIR}/fullchain.pem" "${LOCAL_CERT_DIR}/fullchain.pem"
scp "${VPS_USER}@${VPS_HOST}:${VPS_CERT_DIR}/privkey.pem" "${LOCAL_CERT_DIR}/privkey.pem"

chmod 644 "${LOCAL_CERT_DIR}/fullchain.pem"
chmod 600 "${LOCAL_CERT_DIR}/privkey.pem"
echo "✓ Successfully installed certificates in ${LOCAL_CERT_DIR}"

# WSL -> Windows host target replication (Strict single-user confinement)
if grep -qi microsoft /proc/version 2>/dev/null; then
    target_win_user="${EQT_WIN_USER:-${USER:-}}"
    if [ -n "${target_win_user}" ] && [ -d "/mnt/c/Users/${target_win_user}" ]; then
        win_cert_dir="/mnt/c/Users/${target_win_user}/.config/eqt/certs"
        mkdir -p "${win_cert_dir}"
        cp -f "${LOCAL_CERT_DIR}/fullchain.pem" "${win_cert_dir}/fullchain.pem"
        cp -f "${LOCAL_CERT_DIR}/privkey.pem" "${win_cert_dir}/privkey.pem"
        chmod 644 "${win_cert_dir}/fullchain.pem" 2>/dev/null || true
        chmod 600 "${win_cert_dir}/privkey.pem" 2>/dev/null || true
        echo "✓ Synced certificates strictly to Windows user: ${target_win_user} (${win_cert_dir})"
    else
        echo "ℹ WSL detected, but target Windows user directory not found automatically."
        echo "  Set EQT_WIN_USER=<username> to sync certificates to your specific Windows profile."
    fi
fi

echo "=== [EQT] Certificate verification ==="
openssl x509 -in "${LOCAL_CERT_DIR}/fullchain.pem" -noout -subject -dates
echo "All done! Desktop applications can now use LAN-TLS loopback encryption."
