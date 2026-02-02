╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║         THREE-DISK TO SINGLE-ROOT BTRFS CONVERSION TOOLKIT            ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝

Created: 2025-02-02
Purpose: Convert servers from three-disk setup to single-root btrfs

CONVERSION STRATEGY
═══════════════════

The conversion uses a two-phase approach to ensure safety:

1. INTERMEDIATE PHASE
   - Creates new btrfs partition on extended root disk
   - Copies all data (root, logs, postgres)
   - Updates bootloader
   - Reboots to verify
   - Original ext4 remains intact until this succeeds

2. FINAL PHASE
   - Deletes old ext4 partition
   - Creates final btrfs in its place
   - Copies from intermediate btrfs
   - Updates bootloader again
   - Reboots to final system
   - Cleans up intermediate partition

This ensures there are always two bootable systems available.

FILES INCLUDED
══════════════

1. convert-three-disk-to-btrfs.yml
   Main Ansible playbook with 11 tagged phases
   - 133 tasks total
   - Fully idempotent
   - Resumable at any phase
   - Never auto-runs (all phases tagged with 'never')

2. convert-three-disk-to-btrfs.sh
   Interactive helper script for single-server conversion
   - Step-by-step prompts
   - Safety confirmations
   - Easy to pause and resume

3. batch-disk-conversion.sh
   Batch conversion tool for multiple servers
   - Parallel execution support
   - Progress tracking
   - Can run phases individually

4. check-disk-status.sh
   Pre-conversion validation script
   - Checks disk sizes
   - Validates mount points
   - Calculates space requirements
   - Provides recommendations

5. DISK-CONVERSION-GUIDE.md
   Complete documentation
   - Detailed phase descriptions
   - Recovery procedures
   - Troubleshooting guide
   - Time estimates

6. inventory/disk-conversion-example.yml
   Example inventory file
   - Shows variable overrides
   - Group organization

QUICK START
═══════════

For a single server:
────────────────────
1. Extend root EBS volume to ~100GB in AWS
2. Check status:
   ssh server1 'sudo bash -s' < check-disk-status.sh

3. Run conversion:
   ansible-playbook convert-three-disk-to-btrfs.yml \
     -i inventory/prod.yml \
     -l server1 \
     --tags=phase1

4. Continue through phases (phase2, phase3, ..., reboot1, ...)

For multiple servers:
─────────────────────
1. Extend all root EBS volumes
2. Run batch conversion:
   ./batch-disk-conversion.sh -i inventory/prod.yml -g disk_conversion

PHASES OVERVIEW
════════════════

Phase 1: gather       Validate setup and calculate requirements
Phase 2: extend       Create intermediate btrfs partition
Phase 3: setup        Setup btrfs subvolumes
Phase 4: copy         Copy all data to intermediate
Phase 5: bootloader1  Update bootloader for intermediate
Phase 6: reboot1      Reboot to intermediate btrfs
Phase 7: finalize     Create final btrfs partition
Phase 8: finalcopy    Copy to final btrfs
Phase 9: bootloader2  Update bootloader for final
Phase 10: reboot2     Reboot to final btrfs
Phase 11: cleanup     Remove intermediate, calculate shrink size

RUNNING INDIVIDUAL PHASES
══════════════════════════

ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/prod.yml \
  -l hostname \
  --tags=phase1

Available tags:
  phase1, phase2, phase3, phase4, phase5,
  reboot1,
  phase7, phase8, phase9,
  reboot2,
  phase11

Or use shorthand tags:
  gather, extend, setup, copy, bootloader1,
  finalize, finalcopy, bootloader2,
  cleanup

VARIABLES
═════════

Device names are AUTOMATICALLY DETECTED from your system.
No configuration needed for most cases!

The playbook detects:
  ✓ Root device and partition (nvme, xvd, vd, sd)
  ✓ Partition naming convention (nvme0n1p1 vs xvda1)
  ✓ /var/log device
  ✓ /var/lib/postgresql device

Optional overrides (only if auto-detection fails):
  root_device: /dev/xvda                 # Override detected root
  var_log_device: /dev/xvdb              # Override detected log
  postgresql_device: /dev/xvdc           # Override detected postgres

Conversion parameters (can customize):
  intermediate_partition_number: 2       # Temp partition (default: 2)
  minimum_final_size_gb: 50              # Min final size (default: 50)
  extra_space_gb: 20                     # Extra buffer (default: 20)

Example command line override:
  ansible-playbook ... -e "minimum_final_size_gb=80"

SAFETY FEATURES
═══════════════

✓ All phases require explicit --tags (never runs by accident)
✓ Each phase is idempotent (can re-run safely)
✓ Two-stage conversion (intermediate → final)
✓ Original system bootable until first reboot
✓ Intermediate system bootable until second reboot
✓ fstab backed up at each modification (.pre-btrfs, .pre-final)
✓ Boot verification after each reboot
✓ Filesystem integrity checks at critical points

RECOVERY SCENARIOS
══════════════════

Before First Reboot:
  - Original ext4 system still intact
  - Can abort safely at any time
  - Just delete intermediate partition if needed

Between Reboots:
  - Can boot back to intermediate btrfs
  - Can retry final phases
  - Intermediate has all data

After Second Reboot:
  - System on final btrfs
  - Can still access intermediate if needed
  - Run phase11 to cleanup

ESTIMATED TIME
══════════════

Single server:
  - Small server (20GB used): 45-60 minutes
  - Medium server (50GB used): 1-2 hours
  - Large server (100GB used): 2-3 hours

Multiple servers (sequential):
  - 3 servers: 3-6 hours
  - 5 servers: 5-10 hours

Multiple servers (parallel, -c 3):
  - 3 servers: 1-2 hours
  - 5 servers: 2-4 hours

POST-CONVERSION
═══════════════

1. Verify services are running
2. Check btrfs status: btrfs filesystem usage /
3. Review shrink size from phase11 output
4. Shrink EBS volume in AWS to recommended size
5. Detach and delete old /var/log and /var/lib/postgresql volumes
6. Update monitoring/backups if needed
7. Consider enabling btrfs snapshots

TROUBLESHOOTING
═══════════════

See DISK-CONVERSION-GUIDE.md for detailed troubleshooting.

Common issues:
  - Partition already exists: Delete manually with parted
  - No space: Extend root EBS volume
  - Boot failure: Boot previous partition from GRUB
  - fstab issues: Check UUID with blkid

SUPPORT COMMANDS
════════════════

Check current status:
  findmnt / /var/log /var/lib/postgresql
  df -h
  lsblk

Check btrfs:
  btrfs filesystem show /
  btrfs filesystem usage /
  btrfs subvolume list /

Check boot:
  findmnt -n -o SOURCE /
  cat /etc/fstab

BEFORE YOU START
════════════════

☐ Read DISK-CONVERSION-GUIDE.md
☐ Ensure backups are current
☐ Extend root EBS volume
☐ Run check-disk-status.sh
☐ Verify SSH access is stable
☐ Plan for 1-2 hours of server downtime
☐ Have AWS console access ready
☐ Inform relevant teams

═══════════════════════════════════════════════════════════════════════

Questions? Issues? Check DISK-CONVERSION-GUIDE.md for complete docs.

═══════════════════════════════════════════════════════════════════════
