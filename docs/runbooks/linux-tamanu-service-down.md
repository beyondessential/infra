# Runbook: a Tamanu service is down on a Linux server

A Tamanu unit is not running, the site returns errors, or Canopy reports `tamanu_service`, `tamanu_http` or `version_drift` for a Linux server.
The services and their units are in [LNXRUN](../spec/linux/runtime.md#services) and [paths and units](../reference/linux-paths-and-units.md#units).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Frontline commands on the host are in the Tamanu pack's [maintain Tamanu on Linux](https://github.com/beyondessential/tamanu/blob/main/docs/reference/maintain-tamanu-on-linux.md).
**Never recreate the Podman secret `tamanu-config-key`**, and never delete `/etc/tamanu` or `/var/lib/postgresql`: [ruled-out actions](../ruled-out-actions.md).

## 1. When this applies

One or more of `tamanu-frontend@a|b`, `tamanu-<type>-api@1|2`, `tamanu-<type>-tasks`, `tamanu-facility-sync`, `tamanu-central-fhir-*` or `tamanu-patientportal@a|b` is inactive or restarting, or Caddy cannot reach an upstream.
It does not apply to a deployment on Kubernetes ([down but nothing failed](deployment-down-nothing-failed.md)).

## 2. Establish context

Which server, central or facility, the version, whether a playbook run or a restart just happened, and whether someone stopped Tamanu on purpose: [deployment context](../deployment-context.md) and Canopy's server notes. **[diagnose]**

## 3. Investigate

On the host over SSH. **[diagnose]**

1. What is running: `bestool tamanu status`, then `systemctl list-units 'tamanu-*' --all`.
2. The failing unit: `systemctl status tamanu-central-api@1` and `journalctl -u tamanu-central-api@1 -n 200 --no-pager`. **[sensitive-data]** The log can carry patient identifiers.
3. The boot and roll units: `systemctl status tamanu-boot.service tamanu-roll-on-postgres.service`.
4. Versions on disk, without the password line: `grep -E '^(TAMANU|TZ)' /etc/tamanu/env`, `ls -l /etc/tamanu/current`, `podman images`.
5. The server key exists: `sudo podman secret ls`. **[diagnose]**
6. Caddy's side: the one-liner in [read logs, Caddy access log](../sops/read-logs.md#caddy-access-log).
7. The database: [database not reachable](linux-database-not-reachable.md) if the log says it cannot connect.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Nothing running after a reboot, `tamanu-boot.service` failed | The oneshot that runs `bestool tamanu start` did not complete. | Read its journal. Start it again below. |
| Services running only on one frontend or API instance | A [roll](../spec/linux/runtime.md#boot-and-restart) is part way, or one instance crashed. | Wait for the roll to end, then read the failed instance's log. |
| Services stopped, and `tamanu-roll-on-postgres` was skipped | The roll runs only when a frontend is active, so a Tamanu that was stopped stays stopped. | A person stopped it, or it crashed first. Find out which before starting it. |
| `Missing podman secret tamanu-config-key`, or a crypto error at start | The [server key](../spec/linux/runtime.md#server-key) is gone or was replaced. | Escalate. Do not create a new key: values encrypted under the old one are lost. |
| `manifest unknown` or `unauthorized` on pull, or an image not found | The version in `/etc/tamanu/env` has no image on the host, or `ghcr.io` is unreachable. The playbooks pull before writing the env file, so a hand edit is the usual cause. | Escalate with the version shown. |
| Caddy reports `no such host` or upstream timeouts for `*.tamanu.internal` | Container DNS is not answering on the Podman gateway. | `resolvectl status podman0`, `podman network ls`; escalate if aardvark-dns is down. |
| An instance other than `a`/`b`, `1`/`2` is running | An experiment or leftover. | Reconciling removes it below. |
| `version_drift` | Two API instances on different versions. | Roll to one version below, or escalate for a half-finished upgrade ([upgrade SOP](../sops/linux-upgrade-tamanu.md)). |

## 5. Resolve

Support's steps end at diagnosis. A developer, or support with a developer over the shoulder, runs: **[dev-OTS]**

- `bestool tamanu start` reconciles the set: it starts what is missing and stops what should not run. It is the same step the upgrade ends with.
- `sudo systemctl restart <unit>` or `bestool tamanu restart <service>` for one service ([restart services](https://github.com/beyondessential/tamanu/blob/main/docs/sops/restart-services.md)).
- Re-running the playbooks restores the quadlets, drop-ins and env file ([run the playbooks](../sops/linux-run-playbooks.md)).

Hand edits to `/etc/tamanu/env`, `local.json5` and the quadlets do not survive a run.

## 6. Escalate

Give the deployment, server type, version, the unit and its last 50 redacted log lines, whether a run or restart preceded it, and whether `tamanu-config-key` exists.
