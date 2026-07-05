#!/usr/bin/env bash
# Just-in-time provisioning for a stock `rust` image (no bespoke image is built).
# Idempotent and fast on warm pods: apt layers live on the ephemeral container
# rootfs (reinstalled per pod start, ~seconds), while cargo-installed tools land
# in $CARGO_HOME/bin on the persistent cache volume, so they survive restarts.
#
# Base tooling is always ensured. Cross-compilation tooling (musl / zig-linked
# targets) is heavier and only set up when RUST_BUILD_CROSS=1.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '[setup] %s\n' "$*"; }

# --- base build deps (ephemeral rootfs) -------------------------------------
if ! command -v cmake >/dev/null 2>&1 || ! command -v rsync >/dev/null 2>&1; then
  log "installing base build deps"
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    cmake clang lld pkg-config libssl-dev zlib1g-dev rsync git ca-certificates
fi

# --- common extra rustup targets --------------------------------------------
# Native target ships in the image. These add cheap std-only targets (RUSTUP_HOME
# is the image default / ephemeral, so this reruns per pod but is quick).
log "ensuring common rustup targets"
rustup target add \
  x86_64-unknown-linux-gnu \
  aarch64-unknown-linux-gnu \
  wasm32-unknown-unknown >/dev/null 2>&1 || true

# --- cross-compilation tooling (opt-in) -------------------------------------
if [[ "${RUST_BUILD_CROSS:-0}" == "1" ]]; then
  log "ensuring cross-compile tooling (zig + targets)"
  apt-get install -y --no-install-recommends python3-pip >/dev/null
  # zig is the linker for every cross target (via `cargo zigbuild`), so no
  # per-target C toolchain (mingw-w64, musl-gcc) is needed. `cargo check` links
  # nothing, so adding the target alone is enough to check it.
  rustup target add \
    x86_64-unknown-linux-musl \
    aarch64-unknown-linux-musl \
    x86_64-pc-windows-gnu >/dev/null 2>&1 || true

  # cargo-zigbuild installs into $CARGO_HOME/bin (persisted) — build once.
  command -v cargo-zigbuild >/dev/null 2>&1 || cargo install cargo-zigbuild --locked

  # zig, without pinning a version we'd have to guess: the `ziglang` pip package
  # bundles a matching zig; expose it as a `zig` shim on the persistent PATH.
  if ! command -v zig >/dev/null 2>&1; then
    pip3 install --break-system-packages --quiet ziglang
    cat >/cache/cargo/bin/zig <<'SHIM'
#!/bin/sh
exec python3 -m ziglang "$@"
SHIM
    chmod +x /cache/cargo/bin/zig
  fi
fi

log "ok"
