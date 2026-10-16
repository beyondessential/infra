#!/usr/bin/env bash
SCRIPT_VERSION="2026-03-03"
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root." >&2
  exit 1
fi

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BOLD='\033[1m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BOLD='' DIM='' RESET=''
fi

pass() { printf "${GREEN}PASS${RESET}  %s\n" "$1"; }
fail() { printf "${RED}FAIL${RESET}  %s\n" "$1"; }
warn() { printf "${YELLOW}WARN${RESET}  %s\n" "$1"; }
info() { printf "      %s\n" "$1"; }
heading() { printf "\n${BOLD}── %s${RESET}\n" "$1"; }

if [ "$(date +%Y%m%d)" -ge 20260501 ]; then
  recommended_ubuntu="Ubuntu 26.04 LTS"
else
  recommended_ubuntu="Ubuntu 24.04 LTS"
fi

disk_ok=true
os_ok=true
net_ok=true

advices=()
advice() { advices+=("$1"); }

# --------------------------------------------------------------------------- #
heading "Operating System"
# --------------------------------------------------------------------------- #

if [ -f /etc/os-release ]; then
  . /etc/os-release
  os_id="${ID:-unknown}"
  os_version="${VERSION_ID:-0}"
  os_pretty="${PRETTY_NAME:-unknown}"
else
  os_id="unknown"
  os_version="0"
  os_pretty="unknown"
fi

if [ "$os_id" = "ubuntu" ]; then
  major="${os_version%%.*}"
  if [ "$major" -ge 24 ] 2>/dev/null; then
    pass "Ubuntu ${os_version} (${os_pretty})"
  else
    fail "Ubuntu ${os_version} is older than 24.04"
    os_ok=false
    advice "Reinstall with ${recommended_ubuntu} or later with a btrfs root."
    advice "Move the root filesystem into the @ subvolume."
  fi
elif [ "$os_id" = "debian" ]; then
  warn "Debian detected (${os_pretty}); Ubuntu 24.04+ is preferred"
  info "This may work but is not the recommended path."
else
  fail "Not a Debian-based system (${os_pretty})"
  os_ok=false
  advice "Reinstall with ${recommended_ubuntu} with a btrfs root."
  advice "Move the root filesystem into the @ subvolume."
fi

# --------------------------------------------------------------------------- #
heading "Root Filesystem"
# --------------------------------------------------------------------------- #

root_fstype=$(findmnt -n -o FSTYPE /)
root_options=$(findmnt -n -o OPTIONS /)

has_subvol_at() {
  # Match subvol=@ or subvol=/@ but not subvol=@something-else
  echo "$1" | grep -qE '(^|,)subvol=/?@(,|$)'
}

if [ "$root_fstype" = "btrfs" ]; then
  if has_subvol_at "$root_options"; then
    pass "Root is btrfs with subvol=@"
  else
    fail "Root is btrfs but not mounted with subvol=@"
    disk_ok=false
    subvol_current=$(echo "$root_options" | grep -oE '(^|,)subvol=[^,]+' | head -1 | cut -d= -f2)
    info "Current subvolume: ${subvol_current:-<default>}"
    advice "Root is btrfs but uses the wrong subvolume. An in-place conversion is available: rename or recreate the root subvolume as @."
  fi
elif [ "$root_fstype" = "ext4" ]; then
  fail "Root is ext4, not btrfs"
  disk_ok=false
  if command -v vgs &>/dev/null; then
    vg_free_raw=$(vgs --noheadings --nosuffix --units g -o vg_free 2>/dev/null | head -1 | tr -d ' ' || true)
    if [ -n "$vg_free_raw" ]; then
      vg_free_int=${vg_free_raw%%.*}
      if [ "$vg_free_int" -ge 15 ] 2>/dev/null; then
        info "LVM detected with ${vg_free_raw}G free."
        advice "Root is ext4 on LVM with ≥15 GB free space. An in-place conversion to btrfs is possible (see convert-from-lvm-ext4-to-btrfs.sh), but a clean reinstall with ${recommended_ubuntu} with btrfs is preferred."
        advice "Move the root filesystem into the @ subvolume."
      else
        info "LVM detected but only ${vg_free_raw}G free (need ≥15G for in-place conversion)."
        advice "Reinstall with ${recommended_ubuntu} with a btrfs root."
        advice "Move the root filesystem into the @ subvolume."
      fi
    else
      advice "Reinstall with ${recommended_ubuntu} with a btrfs root."
      advice "Move the root filesystem into the @ subvolume."
    fi
  else
    advice "Reinstall with ${recommended_ubuntu} with a btrfs root."
    advice "Move the root filesystem into the @ subvolume."
  fi
else
  fail "Root filesystem is ${root_fstype}, not btrfs"
  disk_ok=false
  advice "Reinstall with ${recommended_ubuntu} with a btrfs root."
  advice "Move the root filesystem into the @ subvolume."
fi

# --------------------------------------------------------------------------- #
heading "PostgreSQL Subvolume"
# --------------------------------------------------------------------------- #

pg_dir="/var/lib/postgresql"

if findmnt -n "$pg_dir" &>/dev/null; then
  pg_fstype=$(findmnt -n -o FSTYPE "$pg_dir")
  pg_options=$(findmnt -n -o OPTIONS "$pg_dir")
  has_pg_subvol() {
    echo "$1" | grep -qE '(^|,)subvol=/?@postgres(,|$)'
  }
  if [ "$pg_fstype" = "btrfs" ] && has_pg_subvol "$pg_options"; then
    pass "${pg_dir} is btrfs with subvol=@postgres"
  elif [ "$pg_fstype" = "btrfs" ]; then
    fail "${pg_dir} is btrfs but not subvol=@postgres"
    disk_ok=false
    pg_subvol=$(echo "$pg_options" | grep -oE '(^|,)subvol=[^,]+' | head -1 | cut -d= -f2)
    info "Current subvolume: ${pg_subvol:-<default>}"
    advice "Create a @postgres btrfs subvolume and mount it at ${pg_dir}."
  else
    fail "${pg_dir} is mounted as ${pg_fstype}, not btrfs"
    disk_ok=false
    advice "Create a @postgres btrfs subvolume and mount it at ${pg_dir}."
  fi
else
  if [ "$root_fstype" = "btrfs" ]; then
    fail "${pg_dir} has no separate mount (would use root subvolume)"
    disk_ok=false
    advice "Create a @postgres btrfs subvolume and mount it at ${pg_dir} via /etc/fstab."
  else
    fail "${pg_dir} has no separate mount and root is not btrfs"
    disk_ok=false
    # Already covered by root filesystem advice
  fi
fi

# --------------------------------------------------------------------------- #
heading "Tailscale"
# --------------------------------------------------------------------------- #

if command -v tailscale &>/dev/null; then
  ts_version=$(tailscale version 2>/dev/null | head -1 || echo "unknown")
  if tailscale netcheck &>/dev/null; then
    pass "Tailscale installed (${ts_version}) and netcheck succeeds"
  else
    warn "Tailscale installed (${ts_version}) but netcheck failed"
    net_ok=false
    advice "Tailscale is installed but netcheck is failing. Check firewall rules and internet connectivity."
  fi
else
  fail "Tailscale is not installed"
  net_ok=false
  advice "Install Tailscale: curl -fsSL https://tailscale.com/install.sh | sh"
fi

# --------------------------------------------------------------------------- #
heading "IPv6"
# --------------------------------------------------------------------------- #

ipv6_disabled=$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null || echo "1")
if [ "$ipv6_disabled" = "0" ]; then
  ll_addrs=$(ip -6 addr show scope link 2>/dev/null | grep -c inet6 || true)
  if [ "$ll_addrs" -gt 0 ]; then
    pass "IPv6 is enabled (${ll_addrs} link-local address(es))"
  else
    warn "IPv6 is enabled at sysctl level but no link-local addresses found"
    net_ok=false
    advice "IPv6 is enabled but no link-local addresses are present. Check network interface configuration."
  fi
else
  fail "IPv6 is disabled"
  net_ok=false
  advice "Enable IPv6: remove any disable_ipv6 sysctl overrides and ensure /proc/sys/net/ipv6/conf/all/disable_ipv6 is 0."
fi

# --------------------------------------------------------------------------- #
heading "NTP Connectivity"
# --------------------------------------------------------------------------- #

ntp_check() {
  python3 -c "
import socket, sys
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(5)
    s.sendto(b'\x1b' + 47 * b'\0', ('pool.ntp.org', 123))
    data, _ = s.recvfrom(1024)
    if len(data) >= 48:
        sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
finally:
    s.close()
" 2>/dev/null
}

if ntp_check; then
  pass "NTP server reachable (pool.ntp.org:123)"
else
  fail "Cannot reach NTP server (pool.ntp.org:123)"
  net_ok=false
  advice "Ensure UDP port 123 outbound is not blocked by a firewall. NTP is required for correct operation."
fi

# --------------------------------------------------------------------------- #
heading "HTTPS Connectivity (for Tamanu installs)"
# --------------------------------------------------------------------------- #

tamanu_hosts=(
  meta.tamanu.app
  tools.ops.tamanu.io
  clients.ops.tamanu.io
  servers.ops.tamanu.io
  ghcr.io
)

tamanu_https_ok=true
for host in "${tamanu_hosts[@]}"; do
  if curl -sSL --max-time 10 -o /dev/null "https://${host}" 2>/dev/null; then
    pass "https://${host}"
  else
    fail "https://${host}"
    tamanu_https_ok=false
    net_ok=false
  fi
done

if ! $tamanu_https_ok; then
  advice "One or more Tamanu HTTPS endpoints are unreachable. Check DNS resolution, firewall rules, and internet connectivity."
fi

# --------------------------------------------------------------------------- #
printf "\n${BOLD}── Summary${RESET} ${DIM}${SCRIPT_VERSION}${RESET}\n"
# --------------------------------------------------------------------------- #

echo ""

if $disk_ok && $os_ok && $net_ok; then
  printf "${GREEN}${BOLD}All checks passed. Server is ready.${RESET}\n"
elif $disk_ok && $os_ok && ! $net_ok; then
  printf "${YELLOW}${BOLD}Disk and OS are ready, but some network checks failed.${RESET}\n"
  info "The install can proceed, but functionality may be degraded until all network checks are green."
elif ! $disk_ok || ! $os_ok; then
  printf "${RED}${BOLD}Server is not ready.${RESET}\n"
  if ! $net_ok; then
    info "There are also network issues that will need to be resolved."
  fi
fi

if [ ${#advices[@]} -gt 0 ]; then
  echo ""
  printf "${BOLD}Recommended actions:${RESET}\n"
  for i in "${!advices[@]}"; do
    printf "  %d. %s\n" "$((i + 1))" "${advices[$i]}"
  done
fi

echo ""

if $disk_ok && $os_ok; then
  exit 0
else
  exit 1
fi
