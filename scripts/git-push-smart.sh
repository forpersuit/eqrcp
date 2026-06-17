#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
identity_file="${EQT_GIT_SSH_KEY:-$HOME/.ssh/wsl-github}"
ssh_timeout="${EQT_GIT_SSH_PROBE_TIMEOUT:-8}"

proxy_host() {
  ip route | awk '/default/ {print $3; exit}'
}

ssh_base_options() {
  printf "ssh -i %q -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=%q" "$identity_file" "$ssh_timeout"
}

ssh_command_for() {
  local route="$1"
  local host="${2:-}"
  local base
  base="$(ssh_base_options)"
  case "$route" in
    direct-22)
      printf "%s" "$base"
      ;;
    direct-443)
      printf "%s -p 443 -o HostName=ssh.github.com" "$base"
      ;;
    proxy-22)
      printf "%s -o ProxyCommand='nc -X connect -x %s:10808 %%h %%p'" "$base" "$host"
      ;;
    proxy-443)
      printf "%s -p 443 -o HostName=ssh.github.com -o ProxyCommand='nc -X connect -x %s:10808 %%h %%p'" "$base" "$host"
      ;;
    *)
      return 2
      ;;
  esac
}

probe_route() {
  local route="$1"
  local host="${2:-}"
  local command
  local start
  local end
  local elapsed
  command="$(ssh_command_for "$route" "$host")"
  start="$(date +%s%3N)"
  if GIT_SSH_COMMAND="$command" git -C "$root_dir" ls-remote --heads origin >/dev/null 2>&1; then
    end="$(date +%s%3N)"
    elapsed=$((end - start))
    echo "${elapsed} ${route} ${command}"
    return 0
  fi
  echo "skip ${route}: unavailable" >&2
  return 1
}

choose_route() {
  host="$(proxy_host)"
  local candidates=("direct-22" "direct-443")
  if [[ -n "$host" ]]; then
    candidates+=("proxy-22" "proxy-443")
  fi
  local best=""
  local result
  local elapsed
  local route
  local command
  for route in "${candidates[@]}"; do
    if result="$(probe_route "$route" "$host")"; then
      elapsed="${result%% *}"
      command="${result#* * }"
      echo "probe ${route}: ${elapsed}ms" >&2
      if [[ -z "$best" || "$elapsed" -lt "${best%% *}" ]]; then
        best="${elapsed} ${command}"
      fi
    fi
  done
  if [[ -z "$best" ]]; then
    echo "error: no GitHub SSH route is reachable" >&2
    exit 2
  fi
  echo "${best#* }"
}

selected_command="$(choose_route)"
echo "using GitHub SSH route: ${selected_command}" >&2
GIT_SSH_COMMAND="$selected_command" git -C "$root_dir" push "$@"
