# SOP: Convert a Linux server's disk layout

Two conversions exist, both for hosts that are not on the single btrfs layout ([storage layout](../spec/linux/server.md#storage-layout)).
Both rewrite partitions and filesystems and can destroy a filesystem if done wrong, so both are **[dev-OTS]**, run by a developer or ops with downtime planned.
The Tamanu pack puts disk shrink and repartition work in the same class ([ruled-out actions](../ruled-out-actions.md#consequential-but-recoverable-dev-ots)).
Review the playbook or script before running it, and take a backup first ([check backups](linux-check-backups.md)).

## Split layout to a single btrfs root

`ansible/convert-three-disk-to-btrfs.yml`, driven by `ansible/convert-three-disk-to-btrfs.sh <inventory> <hostname> [resume_from_phase]`, converts the three-volume layout (`/`, `/var/log` on `/dev/sdl`, `/var/lib/postgresql` on `/dev/sdp`) into one btrfs root with the `@` and `@postgres` subvolumes.
It is staged and stateful: progress is in `/root/.disk-conversion-metadata-v2.json` on the host, and a stopped run resumes from the named phase.

| phase | what |
|---|---|
| 1 | Detect devices, work out sizes, validate. The target root is at least 30 GB and keeps at least 10 GB free. |
| 2 to 5 | Create an intermediate btrfs partition, copy the system to it, update the bootloader. |
| reboot 1 | Boot from the intermediate btrfs. |
| 7 to 10 | Delete the old ext4 partition, create the final btrfs partition with subvolumes, copy, update the bootloader. |
| reboot 2 | Boot from the final btrfs. |
| 12 | Clean up and resize. |

Confirm afterwards with `check-server-ready.sh`: root is btrfs on `@`, and `/var/lib/postgresql` is btrfs on `@postgres`. **[diagnose]**
Then `postgres-upgrade-check.yml` stops reporting `UPGRADE_BLOCKED` for the filesystem ([upgrade PostgreSQL](linux-upgrade-postgres.md)).

## LVM and ext4 to btrfs

`convert-from-lvm-ext4-to-btrfs.sh` is a record of shell blocks, not a script to run through: its first lines say each block is run individually, carefully.
`check-server-ready.sh` says an in-place conversion needs at least 15 GB free in the volume group, and that a clean reinstall with a btrfs root is preferred.
Do not improvise a different method.
