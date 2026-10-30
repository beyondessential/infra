#!/usr/bin/env bash
# Checks the ufw role's raw before.rules changes against a real ufw: applies
# them with Ansible, enables ufw, and checks which packets it drops, all inside
# a throwaway network namespace so the host's own firewall is untouched.
#
# Needs root, ufw and ansible-playbook on PATH. It edits /etc/ufw on the machine
# it runs on, so run it only on a disposable CI runner or container.
set -euo pipefail

if [ -z "${UFW_TEST_NETNS:-}" ]; then
	exec unshare --net env UFW_TEST_NETNS=1 "$0" "$@"
fi

here=$(cd "$(dirname "$0")" && pwd)

python3 -I - <<'PY'
import fcntl, socket, struct
SIOCSIFFLAGS, IFF_UP, IFF_LOOPBACK = 0x8914, 0x1, 0x8
fcntl.ioctl(socket.socket(socket.AF_INET, socket.SOCK_DGRAM), SIOCSIFFLAGS,
            struct.pack("16sH14x", b"lo", IFF_UP | IFF_LOOPBACK))
PY

ufw --force enable

play() {
	ansible-playbook -i localhost, "$here/before_rules.yml"
}

echo "::group::First run"
first=$(play)
echo "$first"
echo "::endgroup::"
echo "::group::Second run"
second=$(play)
echo "$second"
echo "::endgroup::"
if ! grep -qE 'localhost +: .*changed=0 ' <<<"$second"; then
	echo "Second run changed something: the before.rules tasks are not idempotent" >&2
	exit 1
fi

if ! ufw reload; then
	echo "ufw refused the edited before.rules" >&2
	exit 1
fi

python3 -I "$here/packets.py"
