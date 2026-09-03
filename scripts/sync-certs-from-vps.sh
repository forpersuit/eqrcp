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

# WSL -> Windows host automatic replication
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "WSL environment detected. Checking Windows host users..."
    for win_user in /mnt/c/Users/*; do
        user_name="$(basename "${win_user}")"
        if [ "${user_name}" != "All Users" ] && [ "${user_name}" != "Default" ] && [ "${user_name}" != "Default User" ] && [ "${user_name}" != "Public" ]; then
            win_cert_dir="${win_user}/.config/eqt/certs"
            mkdir -p "${win_cert_dir}" 2>/dev/null || true
            if [ -d "${win_cert_dir}" ]; then
                cp -f "${LOCAL_CERT_DIR}/fullchain.pem" "${win_cert_dir}/fullchain.pem" 2>/dev/null || true
                cp -f "${LOCAL_CERT_DIR}/privkey.pem" "${win_cert_dir}/privkey.pem" 2>/dev/null || true
                echo "✓ Synced certificates to Windows host: ${win_cert_dir}"
            fi
        fi
    done
fi

echo "=== [EQT] Certificate verification ==="
openssl x509 -in "${LOCAL_CERT_DIR}/fullchain.pem" -noout -subject -dates
echo "All done! Desktop applications can now use LAN-TLS loopback encryption."
