# Three-Disk to Single-Root BTRFS Conversion Guide

## Overview

This playbook converts servers from a three-disk setup to a single-root btrfs filesystem:

**Before:**
- Disk 1: 10GB ext4 + gpt as /
- Disk 2: 10GB whole disk btrfs as /var/log
- Disk 3: 50GB whole disk ext4 as /var/lib/postgresql

**After:**
- Single disk with btrfs root filesystem
- Subvolumes: @ (root), @log, @postgres
- Compression: zstd:6
- 4GB swap file

## Prerequisites

1. **Backups**: Ensure all data is backed up
2. **AWS Access**: Ability to extend/shrink EBS volumes
3. **Extend Root Disk**: Extend the root EBS volume to at least 100GB before starting
4. **SSH Access**: Reliable SSH connection to target server

## Configuration Variables

**Device names are automatically detected** from your current system setup. You only need to override them in inventory if the detection fails or you want to use specific devices.

Optional overrides in inventory:

```yaml
vars:
  # Device detection is automatic - only override if needed
  # root_device: /dev/xvda                # Override detected root device
  # var_log_device: /dev/xvdb             # Override detected log device
  # postgresql_device: /dev/xvdc          # Override detected postgres device
  
  # Conversion parameters (can be customized)
  intermediate_partition_number: 2       # Temporary partition number
  minimum_final_size_gb: 50              # Minimum final disk size
  extra_space_gb: 20                     # Extra space buffer
```

The playbook automatically:
- Detects root device and partition (works with /dev/nvme*, /dev/xvd*, /dev/vd*, /dev/sd*)
- Determines if your system uses 'p' separator for partitions (nvme0n1p1 vs xvda1)
- Finds /var/log and /var/lib/postgresql devices
- Calculates intermediate and final partition paths

## Execution Steps

### Step 1: Extend EBS Volume in AWS

Before running the playbook, extend the root EBS volume:

```bash
# Get current volume size
aws ec2 describe-volumes --volume-ids vol-xxxxx

# Modify volume size to at least 100GB
aws ec2 modify-volume --volume-id vol-xxxxx --size 100
```

### Step 2: Run Phase 1 - Information Gathering

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase1
```

**Review the output carefully:**
- Current disk usage
- Required intermediate partition size
- Verify mount points are correct

### Step 3: Run Phase 2 - Create Intermediate Partition

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase2
```

Creates intermediate btrfs partition with space for all data.

### Step 4: Run Phase 3 - Setup Subvolumes

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase3
```

Creates btrfs subvolumes: @, @log, @postgres and mounts them.

### Step 5: Run Phase 4 - Copy Data

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase4
```

Copies all system data, logs, and PostgreSQL data to intermediate btrfs.
**Note**: This stops PostgreSQL during the final copy.

### Step 6: Run Phase 5 - Update Bootloader

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase5
```

Updates initramfs and GRUB to boot from intermediate btrfs.

### Step 7: First Reboot

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=reboot1
```

Reboots into intermediate btrfs. The playbook will wait for the system to come back up and verify the boot.

**If reboot fails:** You can still boot from the original ext4 partition.

### Step 8: Run Phase 7 - Create Final Partition

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase7
```

Deletes the old ext4 partition and creates the final btrfs partition in its place.

### Step 9: Run Phase 8 - Copy to Final

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase8
```

Copies all data to the final btrfs partition.

### Step 10: Run Phase 9 - Update Bootloader for Final

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase9
```

Updates bootloader to use the final btrfs partition.

### Step 11: Second Reboot

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=reboot2
```

Reboots into final btrfs filesystem.

### Step 12: Run Phase 11 - Cleanup

```bash
ansible-playbook convert-three-disk-to-btrfs.yml \
  -i inventory/your-inventory.yml \
  -l target-host \
  --tags=phase11
```

- Removes intermediate partition
- Resizes filesystem to target size
- Moves GPT backup table
- Calculates AWS shrink size

**Output will show:** The size you can shrink the EBS volume to in AWS.

## Recovery Scenarios

### Recovery: Failed During Phase 1-5

The system can still boot from the original ext4 partition. Simply stop and investigate the issue.

### Recovery: Failed After First Reboot (Phase 6)

If the intermediate btrfs won't boot:
1. Reboot the instance
2. In GRUB, select the original ext4 partition
3. Delete the intermediate partition: `parted /dev/nvme0n1 rm 2`
4. Investigate and fix the issue

### Recovery: Failed After Second Reboot (Phase 10)

If the final btrfs won't boot:
1. Reboot the instance
2. In GRUB, select the intermediate btrfs partition
3. You can either:
   - Fix the final partition and retry phase 9
   - Continue using the intermediate partition (it's functional)

## Post-Conversion Steps

1. **Verify Services**: Check that all services are running correctly
   ```bash
   systemctl status postgresql
   systemctl status podman
   ```

2. **Check Disk Usage**:
   ```bash
   df -h / /var/log /var/lib/postgresql
   btrfs filesystem usage /
   btrfs subvolume list /
   ```

3. **Shrink EBS Volume in AWS**:
   - Stop the instance
   - Create a snapshot of the volume (recommended)
   - Modify the volume size to the recommended size from phase 11
   - Start the instance

4. **Remove Old Disks**: In AWS, detach and delete the old /var/log and /var/lib/postgresql volumes

5. **Enable btrfs Snapshots**: If desired, enable automatic snapshots using the baseline role

## Verification Commands

After conversion, verify the setup:

```bash
# Check mounts
findmnt / /var/log /var/lib/postgresql

# Check btrfs status
btrfs filesystem show /
btrfs filesystem usage /
btrfs subvolume list /

# Check compression
compsize /

# Check fstab
cat /etc/fstab

# Check swap
swapon --show
```

## Troubleshooting

### Issue: "Partition already exists"

The intermediate or final partition wasn't cleaned up. Manually remove it:
```bash
parted /dev/nvme0n1 print
parted /dev/nvme0n1 rm <partition-number>
```

### Issue: "No space left on device"

The root disk wasn't extended enough. Extend it in AWS and run `partprobe`.

### Issue: "Failed to update GRUB"

Check that /boot and /boot/efi are properly mounted before chroot.

### Issue: "System won't boot after reboot"

1. Boot from rescue mode or previous partition
2. Check /etc/fstab for correct UUIDs
3. Verify GRUB configuration
4. Check that initramfs was updated

## Safety Features

- **Never** tagged: All phases require explicit `--tags` to run
- **Idempotent**: Most tasks can be re-run safely
- **Phased**: Each step is separate, allowing recovery
- **Verified**: Boot verification after each reboot
- **Backups**: fstab is backed up at each modification

## Time Estimates

- Phase 1-3: 5 minutes
- Phase 4: 10-30 minutes (depends on data size)
- Phase 5-6: 10 minutes
- Phase 7: 2 minutes
- Phase 8: 10-30 minutes (depends on data size)
- Phase 9-10: 10 minutes
- Phase 11: 5 minutes

**Total**: 1-2 hours depending on data size