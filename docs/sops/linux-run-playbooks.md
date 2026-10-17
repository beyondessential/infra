# SOP: Run the Linux playbooks

Run `base-install.yml`, `tamanu-install.yml` or another playbook against a Linux deployment.
What each playbook and role does is in [Linux playbooks and roles](../reference/linux-roles.md).
A run that changes a server is **[dev-OTS]**: no source pre-signs it.
Read the script or playbook before running it, and review any command you adapt.

## Before the first run

1. Install the tooling: `ansible/setup.sh` installs the Python dependencies with `uv`, writes `~/.ansible.cfg` from `example.ansible.cfg`, and installs the Galaxy requirements.
2. Be on the tailnet, with Canopy administrator access: [inventory](../reference/linux-inventory.md).
3. Know the deployment's Canopy group and rank, and whether the run is `configure` or `upgrade`.

## Look before changing

A check run with a diff changes nothing on the servers. **[diagnose]**
It still takes the run lease, so another operator is refused while it runs.

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> \
  ansible-playbook -i inventory/canopy.yml tamanu-install.yml --check --diff --limit <host>
```

Some tasks cannot be predicted in check mode (clone sync passwords, for one), so read a check run as a guide, not a guarantee.

## Run

The same command without `--check`. **[dev-OTS]**

| goal | how |
|---|---|
| New server | `base-install.yml`, then `tamanu-install.yml`, per [provision a server](linux-provision-server.md). |
| Bring a server in line with the inventory | `tamanu-install.yml --limit <host>`. It is idempotent. |
| One concern | `--tags` with a role tag from [the roles page](../reference/linux-roles.md), such as `caddy`, `postgres`, `munin`, `bestool`. `base` is everything that is not the Tamanu app; `app` is the Tamanu app and mSupply. |
| Skip the app | `--skip-tags app`. The `bestool` role is tagged `base`, so the bestool daemon is still set up. |
| Upgrade | [Upgrade Tamanu](linux-upgrade-tamanu.md). |

Handlers are tagged `always`, so a tag-limited run still reloads or restarts what it changed.

## What a run does not do

- A change to PostgreSQL settings that needs a restart is not applied on a production server, whose Tailscale name contains `prod`: the run prints a warning and leaves the restart to you ([restart pending](../runbooks/linux-postgres-restart-pending.md)).
- A run does not restart Tamanu. `/etc/tamanu/env` and `local.json5` change on disk and take effect when the services next restart.
- The first run on a host does not wire the Munin PostgreSQL plugins, because `munin` runs after `postgres`. They appear on the next run.
- Secret variables are missing when the inventory came from the cache. Do not run a play that needs one from the cache ([playbook refused](../runbooks/linux-playbook-refused.md)).

## After

1. `bestool tamanu doctor` on the host, and the checks in Canopy. **[diagnose]**
2. The Tamanu pack's [restart services](https://github.com/beyondessential/tamanu/blob/main/docs/sops/restart-services.md) covers a restart that the run leaves for you.
3. Confirm the run released the lease: the next read must not be refused.
