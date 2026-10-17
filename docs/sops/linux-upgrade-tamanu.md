# SOP: Upgrade Tamanu on Linux servers

Move a deployment to a new Tamanu version, or only its frontend.
The sequence the playbook follows is in [LNXANS](../spec/linux/ansible.md#upgrades).
An upgrade is **[dev-OTS]**: it stops services and migrates the database.

## Before

1. Set `tamanu_version` (and `tamanu_frontend_version` if it differs) in Canopy. A production deployment also needs an open upgrade plan in Canopy, or the read is refused ([inventory](../reference/linux-inventory.md#upgrade-intent)).
2. Confirm a recent backup of the database and the server key exists ([check backups](linux-check-backups.md)). **[diagnose]**
3. Confirm the versions do not go down: the plays refuse a lower `v` version unless `tamanu_allow_downgrade` is set. **[diagnose]**
4. If PostgreSQL is also changing, finish [upgrade PostgreSQL](linux-upgrade-postgres.md) first.
5. Confirm `bestool` is 1.21.0 or later on every host. The play stops otherwise. **[diagnose]**

## Run

Read the inventory with the intent `upgrade`; the playbook asserts it.

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> CANOPY_INTENT=upgrade \
  ansible-playbook -i inventory/canopy.yml tamanu-upgrade.yml
```

| phase | tag | what happens |
|---|---|---|
| Sanity | `pre`, `go` | `tamanu_version` is set and the intent is `upgrade`. |
| Pre | `pre` | Repeats the install roles so that images are pulled, config for the new version is written, and the environment file is updated. |
| Go | `go` | Stops the API, tasks, sync and FHIR services, rolls the frontend and portal, migrates, restarts everything, prunes old images. |

The frontend keeps serving while the database migrates.
The central play runs before the facility play.

For a frontend-only change use `tamanu-frontend-upgrade.yml`, which leaves the backend version at the value in `/etc/tamanu/env` and refuses where that has none.

## If it stops part way

The final `bestool tamanu start` is idempotent and also recovers services left stopped by an earlier partial run, so running the upgrade again is the first step. **[dev-OTS]**
A migration that fails again is a Tamanu fault: stop and escalate with the migration output ([escalation](../runbooks/linux-tamanu-service-down.md#6-escalate)).
Do not edit `/etc/tamanu/env`: the next run rewrites it.

## Rolling back

A version below the deployed one is refused unless `tamanu_allow_downgrade` is true, and database migrations are not reversed by a downgrade.
The previous version's images and configuration directory are kept, so the services can start on them, but whether the migrated database is compatible is a developer's judgement.
Treat any rollback as **[dev-OTS]** and escalate first.

## After

Check `bestool tamanu doctor`, the checks in Canopy, and `version_drift`. **[diagnose]**
Images other than the new and the previous versions are removed by the run; `podman images` shows what remains.
