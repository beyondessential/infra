# Test cases: Microsoft Defender for Endpoint on Linux servers

## Agent selection

- [ ] `endpoint_security_agent: defender` with an onboarding file installs and onboards Defender, and the device appears in the Defender portal (verifies spec: LNXSRV)
- [ ] Switching a server from Elastic to Defender removes the Elastic Agent and `/opt/Elastic` before Defender is installed (verifies spec: LNXSRV)
- [ ] Switching a server from Defender to `none` purges `mdatp` and removes `/etc/opt/microsoft/mdatp` (verifies spec: LNXSRV)
- [ ] `elastic_agent_enabled: true` with `endpoint_security_agent: defender` runs Elastic, not Defender (verifies spec: LNXSRV)
- [ ] `endpoint_security_agent: defender` without `defender_onboarding` leaves Defender removed (verifies spec: LNXSRV)

## Settings

- [ ] `mdatp health` reports real-time enforcement by default, and passive where `defender_passive` is true (verifies spec: LNXSRV)
- [ ] Files under `/var/lib/postgresql`, and files the PostgreSQL server opens elsewhere, are not scanned (verifies spec: LNXSRV)
- [ ] `defender_group_tag` shows as the device's `GROUP` tag in the Defender portal (verifies spec: LNXSRV)

## Compatibility

- [ ] On a server with the kernel hardening of card H4 applied (lockdown in integrity mode, `debugfs=off`, the H4 kernel parameters and module blocklist, AppArmor), Defender installs, `mdatp health` reports healthy, and `supplementary_events_subsystem` is `ebpf`
- [ ] Defender runs on an arm64 server and an amd64 server
