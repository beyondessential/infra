"""Send TCP connections over loopback and check which ones the firewall drops.

Run by run.sh inside a network namespace where ufw is enabled with the ufw
role's before.rules changes. Add a case to CASES when a raw rule is added.
"""

import socket
import sys

# (description, IPv4 options to set on the client socket, expect the connection dropped)
CASES = [
    ("plain TCP", b"", False),
    # Record Route (type 7, length 7, pointer 4, one empty slot) padded with End of Options.
    ("TCP with IPv4 Record Route option", b"\x07\x07\x04" + b"\x00" * 4 + b"\x00", True),
    # Timestamp (type 68, length 8, pointer 5, flags 0, one empty slot).
    ("TCP with IPv4 Timestamp option", b"\x44\x08\x05\x00" + b"\x00" * 4, True),
]


def connects(options: bytes, port: int) -> bool:
    client = socket.socket()
    client.settimeout(1)
    if options:
        client.setsockopt(socket.IPPROTO_IP, socket.IP_OPTIONS, options)
    try:
        client.connect(("127.0.0.1", port))
        return True
    except (TimeoutError, ConnectionRefusedError):
        return False
    finally:
        client.close()


def main() -> int:
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(16)
    port = server.getsockname()[1]

    failed = 0
    for description, options, dropped in CASES:
        got = not connects(options, port)
        ok = got == dropped
        failed += not ok
        verdict = "dropped" if got else "connected"
        print(f"{'ok  ' if ok else 'FAIL'} {description}: {verdict}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
