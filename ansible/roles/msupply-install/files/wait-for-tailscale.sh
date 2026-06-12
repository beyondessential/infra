#!/bin/sh
# Wait for tailscaled to reach the Running backend state before advertising the
# mSupply service. Polls for up to 2 minutes (60 attempts x 2s).
#
# This lives in its own script rather than inline in the systemd unit because
# systemd applies its own quote/escape parsing to ExecStartPre=, which mangles
# any embedded quotes in a grep pattern and breaks the readiness check.
set -eu

for _ in $(seq 1 60); do
	if tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; then
		exit 0
	fi
	sleep 2
done

echo "tailscaled did not reach Running state within timeout" >&2
exit 1
