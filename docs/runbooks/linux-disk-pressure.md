# Runbook: a Linux server is running out of disk

The `disk_free`, `btrfs` or `inodes` check fails, a write fails with `ENOSPC`, PostgreSQL stops, or Tamanu cannot store a document.
The layouts and volumes are in [LNXSRV](../spec/linux/server.md#storage-layout).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
**Never delete files under `/var/lib/postgresql`, a snapshot, or a btrfs subvolume to free space**, and never shrink or repartition a disk ([disk work](../sops/linux-convert-disk-layout.md)).
Deep disk and AWS-level work is for developers and ops.

## 1. When this applies

Any Linux server where free space or inodes are low.
A btrfs filesystem can be full while `df` shows space, so check both views.

## 2. Establish context

Which server and layout (single, or split with `/var/log` and `/var/lib/postgresql` on their own volumes), how fast it is growing, and whether an upgrade or backup is running. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

**[diagnose]**

1. Space and inodes: `df -h`, `df -i`.
2. btrfs allocation: `sudo btrfs filesystem usage /` and `sudo btrfs filesystem usage /var/lib/postgresql`. Data, metadata and unallocated space each matter.
3. Where it went: `sudo du -xh --max-depth=1 /var | sort -h | tail`, then `/var/log`.
4. Snapshots that hold space: `sudo btrfs subvolume list -t /`. Pre-upgrade snapshots (`@postgres-pre-pgupgrade-...`) and leaked backup snapshots appear here.
5. Journal: `journalctl --disk-usage`. It is capped at 1 GiB.
6. Containers: `sudo podman system df`, `podman images`.
7. Caddy: `ls -lh /var/log/caddy`. Capped at 100 MiB times 10 files.
8. PostgreSQL temp files: `sudo -u postgres psql -X -c "SHOW temp_file_limit;"`, and the largest files under `base/pgsql_tmp`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| `/var/log` full on a split layout | The 10 GiB logs volume filled. | Find the writer; escalate for a resize. |
| Pre-upgrade snapshot `@postgres-pre-pgupgrade-...` large | The snapshot pins the old data after the upgrade ([upgrade PostgreSQL](../sops/linux-upgrade-postgres.md)). | A developer removes it once the new version has run cleanly. **[dev-OTS]** |
| Snapshots named by the backup, left after a crash | A hard reboot skipped cleanup. | The next backup removes them ([PPB](../spec/postgres-physical-backup.md#reliability)). Escalate if it does not. |
| Many untagged or old images | Pruning only removes dangling images daily, and the upgrade keeps the new and previous versions. | `podman images` shows them. Pruning is **[dev-OTS]**. |
| `pgsql_tmp` large | A query spilled to disk, up to `temp_file_limit`. | The limit aborts the query. Escalate if repeated. |
| Metadata full, data free | btrfs needs a balance. | The weekly balance runs on the `btrfs-balance.timer`: `systemctl list-timers 'btrfs-*'`. Escalate. |
| Inodes full | Many small files. | `df -i`, find the directory, escalate. |
| Quota set (`postgresql_btrfs_quota_percent`) and the subvolume at its limit | PostgreSQL cannot grow past the cap. | Raising the cap or the disk is a developer's decision. |

## 5. Resolve

Support's steps end at diagnosis.
A developer may, **[dev-OTS]**: vacuum the journal (`sudo journalctl --vacuum-size=<size>`), prune images, grow the volume in AWS then the filesystem, or remove a stale snapshot.
Growing a root volume is not done by the stack: its size is `ignoreChanges`, so a config change does not resize it.
The `ebs-volume` role grows the filesystem of a split-layout volume when `tamanu-install.yml` runs after the volume is grown.

## 6. Escalate

Give the server, layout, the `btrfs filesystem usage` output, the largest directories, the snapshots, and the growth rate.
