# Runbook: a Linux playbook refuses to run or stops early

`ansible-playbook` exits before changing anything, or stops on an assertion.
The inventory rules are in [LNXSRV](../spec/linux/server.md#inventory) and [inventory](../reference/linux-inventory.md); the upgrade rules are in [LNXAPP](../spec/linux/application.md#versions).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Reading a message and re-reading the inventory are **[diagnose]**; every change below is **[dev-OTS]**.

## 1. When this applies

The run prints `canopy inventory:` followed by a reason, or fails an assertion, or fails a task early in a play.

## 2. Investigate

Read the first error, not the last. Match it below.

| Message contains | Diagnosis | Action |
|---|---|---|
| `give exactly one of group or group_id` | No deployment selected, or both. | Set `CANOPY_GROUP` or `CANOPY_GROUP_ID`, and `CANOPY_RANK`. |
| `set CANOPY_URL` | No Canopy address. | Set `CANOPY_URL`. |
| `is not https` | The URL is plain HTTP and not loopback; the answer carries secrets. | Use the `https` URL. |
| `the canopy_lease callback is not loaded` | `ansible.cfg` lacks `callback_plugins = ./callback_plugins`. | Run `ansible/setup.sh`, or copy `example.ansible.cfg`, and run from `ansible/`. |
| `canopy refused this inventory: ...` | Canopy answered no: an environment held by another run's lease, no administrator access, or `upgrade` of production with no open upgrade plan. | Read the quoted reason. A held lease frees when that run ends or after about 30 minutes. For a plan, open one in Canopy. |
| `redirects to` | `CANOPY_URL` points at a redirecting address. | Point it at Canopy itself. |
| `none of canopy's N members carry managed_by_ansible` | No machine opted in. | Set `managed_by_ansible` on the applications this repo configures. |
| `... and nothing cached at` | Canopy unreachable and no cache. | Restore connectivity. |
| Warning `using ... which may be out of date`, then a task fails on an undefined variable | The cache holds no secret values, so `salt` or another secret is unset. | Re-read from Canopy; never run an install from the cache. |
| `an upgrade needs canopy's answer and never runs from the cache` | Intent `upgrade` and Canopy unreachable. | Restore connectivity. |
| `canopy_intent is ..., so canopy never checked for an upgrade plan` | An upgrade playbook read with `configure`. | Add `CANOPY_INTENT=upgrade` ([upgrade SOP](../sops/linux-upgrade-tamanu.md)). |
| `tamanu_version is not defined` | The version is not set in Canopy. | Set it. |
| `Refusing to downgrade tamanu_version` or `tamanu_frontend_version` | The requested `v` version is lower than the one in `/etc/tamanu/env`. | Correct the version. A real downgrade needs `tamanu_allow_downgrade` and a developer. |
| `Tamanu install/upgrade requires bestool >= 1.21.0` | An older `bestool` package on the host. | Run the `toolbox` tag, or `apt install bestool` ([dev-OTS](../sops/linux-run-playbooks.md)). |
| `/etc/tamanu/env does not have TAMANU_VERSION set` | A frontend-only upgrade on a host never installed. | Run `tamanu-install.yml` first. |
| `Missing podman secret tamanu-config-key` (from `tamanu-run`) | No server key on the host. | Escalate: do not create one on a host that held data. |
| `pg_lsclusters does not resolve 'main'` | Two online `main` clusters, or a data directory that is not the live one. | Escalate; the backup resolves the cluster by this name ([LNXDB](../spec/linux/database.md#version-and-layout)). |
| `PostgreSQL upgrade needed but disallowed on this filesystem` | Data is not on btrfs. | [Convert the layout](../sops/linux-convert-disk-layout.md). |
| `Downgrade detected!` for PostgreSQL | `postgresql_version` is lower than installed. | Correct the version. |

## 3. Resolve

Fix the input and run again; a run that stopped before changing anything has nothing to undo.
A run that stopped part way is safe to repeat: the roles are idempotent and the upgrade's last step recovers services left stopped.

## 4. Escalate

Escalate for a lease that does not free, for an assertion about the cluster layout or the server key, and for any failure you cannot match above.
Give the playbook, the flags, the first error with secrets removed, and whether the inventory came from Canopy or the cache.
