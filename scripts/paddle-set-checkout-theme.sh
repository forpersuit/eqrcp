#!/usr/bin/env bash
#
# Set the EQT brand color on Paddle Checkout for both sandbox and live accounts.
#
# The checkout brand color is an ACCOUNT-level setting (primary_checkout_color)
# on the /settings/account endpoint — it is not a code change in the website.
# PATCH is partial: only the fields we send change; the existing default payment
# link, tax mode and saved-payment-method settings are left untouched.
#
#   Sandbox: PATCH https://sandbox-api.paddle.com/settings/account
#   Live:    PATCH https://api.paddle.com/settings/account
#   Auth:    Seller (server-side) API key — pdl_test_... / pdl_live_...
#
# Usage:
#   PADDLE_KEY_SANDBOX=pdl_test_xxx PADDLE_KEY_LIVE=pdl_live_xxx \
#     ./scripts/paddle-set-checkout-theme.sh
#
# Env options:
#   EQT_PRIMARY_COLOR   brand hex, default #39e5b6 (product theme primary)
#   EQT_CHECKOUT_URL    optional: also set the default payment link on BOTH envs.
#                       Required for checkout to open at all; live's domain must
#                       be approved first. If omitted, the link is not touched.

set -euo pipefail

EQT_PRIMARY_COLOR="${EQT_PRIMARY_COLOR:-#39e5b6}"
SANDBOX_BASE="https://sandbox-api.paddle.com"
LIVE_BASE="https://api.paddle.com"

[[ "$EQT_PRIMARY_COLOR" =~ ^#[0-9A-Fa-f]{6}$ ]] \
  || { printf '✗ EQT_PRIMARY_COLOR must be a #RRGGBB hex (got: %s)\n' "$EQT_PRIMARY_COLOR" >&2; exit 1; }

body="{\"primary_checkout_color\":\"$EQT_PRIMARY_COLOR\""
if [[ -n "${EQT_CHECKOUT_URL:-}" ]]; then
  body+=",\"default_checkout_url\":\"$EQT_CHECKOUT_URL\""
fi
body+="}"

patch_account() {
  local label="$1" base="$2" key="$3"
  if [[ -z "$key" ]]; then
    printf 'skip %-8s no key (set PADDLE_KEY_%s)\n' "$label" "$label"
    return 0
  fi

  local out http
  out="$(mktemp)"
  http="$(curl -sS -o "$out" -w '%{http_code}' -X PATCH "$base/settings/account" \
    -H "Authorization: Bearer $key" \
    -H 'Content-Type: application/json' \
    -d "$body")" || true

  if [[ "$http" == "000" ]]; then
    printf '✗ %-8s transport error (no HTTP response)\n' "$label" >&2
    rm -f "$out"
    return 1
  fi
  if [[ "$http" == "200" ]]; then
    printf '✓ %-8s %s\n' "$label" "$(cat "$out")"
  else
    printf '✗ %-8s HTTP %s: %s\n' "$label" "$http" "$(cat "$out")" >&2
    rm -f "$out"
    return 1
  fi
  rm -f "$out"
}

fail=0
patch_account "SANDBOX" "$SANDBOX_BASE" "${PADDLE_KEY_SANDBOX:-}" || fail=1
patch_account "LIVE"    "$LIVE_BASE"    "${PADDLE_KEY_LIVE:-}"    || fail=1
[[ "$fail" == "0" ]] || exit 1
