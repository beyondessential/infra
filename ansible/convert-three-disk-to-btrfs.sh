#!/bin/bash
set -e

cat << 'EOF'
Three-Disk to Single-Root BTRFS Conversion Script
==================================================

This script guides you through converting a three-disk setup to single-root btrfs.

IMPORTANT: Review the playbook and understand each phase before running.

Prerequisites:
- Ansible installed and configured
- SSH access to target server
- Backups of all data (recommended)
- AWS access to extend/modify EBS volumes

Usage:
  ./convert-three-disk-to-btrfs.sh <inventory> <hostname> [resume_from_phase]

Examples:
  ./convert-three-disk-to-btrfs.sh inventory/prod.yml server1
  ./convert-three-disk-to-btrfs.sh inventory/prod.yml server1 phase7

Phases:
  1. phase1     - Detect devices, calculate parameters, and validate setup
  2. phase2     - Create intermediate btrfs partition
  3. phase3     - Setup intermediate btrfs filesystem
  4. phase4     - Copy system data to intermediate btrfs
  5. phase5     - Update bootloader for intermediate btrfs
  6. reboot1    - Reboot to intermediate btrfs
  7. phase7     - Delete old ext4, create final btrfs with subvolumes
  8. phase8     - Copy to final btrfs
  9. phase9     - Update bootloader for final btrfs
  10. reboot2   - Reboot to final btrfs
  11. phase11   - Cleanup and calculate shrink size

Run phases individually with:
  ansible-playbook convert-three-disk-to-btrfs.yml -i <inventory> -l <hostname> --tags=<phase>

EOF

if [ $# -lt 2 ]; then
    echo "Error: Missing arguments"
    echo "Usage: $0 <inventory> <hostname> [resume_from_phase]"
    exit 1
fi

INVENTORY="$1"
HOSTNAME="$2"
RESUME_FROM="${3:-}"
PLAYBOOK="convert-three-disk-to-btrfs.yml"

if [ ! -f "$PLAYBOOK" ]; then
    echo "Error: Playbook $PLAYBOOK not found"
    exit 1
fi

if [ ! -f "$INVENTORY" ]; then
    echo "Error: Inventory $INVENTORY not found"
    exit 1
fi

run_phase() {
    local phase=$1
    local desc=$2
    echo ""
    echo "========================================"
    echo "PHASE: $desc"
    echo "========================================"
    echo ""
    read -p "Press Enter to run phase '$phase', or Ctrl+C to abort: "
    uv run ansible-playbook "$PLAYBOOK" -i "$INVENTORY" -l "$HOSTNAME" --tags="$phase"
}

echo ""
echo "Starting conversion for host: $HOSTNAME"
if [ -n "$RESUME_FROM" ]; then
    echo "Resuming from: $RESUME_FROM"
fi
echo ""

# Phase 1
if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "phase1" ]; then
    run_phase "phase1" "Detect devices, calculate parameters, and validate"
    RESUME_FROM=""
elif [ "$RESUME_FROM" != "phase1" ]; then
    echo "Skipping phase1 (resuming from $RESUME_FROM)"
fi

# Phase 2 confirmation
if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "phase2" ]; then
    if [ -z "$RESUME_FROM" ]; then
        echo ""
        echo "========================================"
        echo "DISK SPACE REQUIREMENTS"
        echo "========================================"
        echo ""
        echo "Review the disk space calculations and partition tables above."
        echo "You need to extend the root EBS volume to the 'Total disk space needed' size shown."
        echo ""
        read -p "Have you extended the root EBS volume in AWS to the required size? (yes/no): " answer
        if [ "$answer" != "yes" ]; then
            echo "Please extend the root EBS volume in AWS, then run this script again."
            echo "You can resume from phase2 with: $0 $INVENTORY $HOSTNAME phase2"
            exit 1
        fi

        read -p "Continue with conversion? (yes/no): " answer
        if [ "$answer" != "yes" ]; then
            echo "Conversion aborted."
            exit 1
        fi
    fi
    run_phase "phase2" "Create intermediate btrfs partition"
    RESUME_FROM=""
elif [ "$RESUME_FROM" != "phase2" ]; then
    echo "Skipping phase2"
fi

# Phase 3-5
for phase_info in "phase3:Setup intermediate btrfs filesystem" "phase4:Copy system data to intermediate btrfs" "phase5:Update bootloader for intermediate btrfs"; do
    phase="${phase_info%%:*}"
    desc="${phase_info#*:}"
    if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "$phase" ]; then
        run_phase "$phase" "$desc"
        RESUME_FROM=""
    elif [ "$RESUME_FROM" != "$phase" ]; then
        echo "Skipping $phase"
    fi
done

# Reboot 1
if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "reboot1" ]; then
    echo ""
    echo "========================================"
    echo "READY FOR FIRST REBOOT"
    echo "========================================"
    echo ""
    echo "The system will now reboot into the intermediate btrfs."
    echo "Ansible will wait for the system to come back online."
    echo ""
    read -p "Press Enter to reboot, or Ctrl+C to abort: "

    run_phase "reboot1" "Reboot to intermediate btrfs"

    echo ""
    echo "First reboot complete. Continuing with phase 7..."
    echo ""
    RESUME_FROM=""
elif [ "$RESUME_FROM" != "reboot1" ]; then
    echo "Skipping reboot1"
fi

# Phase 7-9
for phase_info in "phase7:Delete old ext4 and create final btrfs" "phase8:Copy to final btrfs" "phase9:Update bootloader for final btrfs"; do
    phase="${phase_info%%:*}"
    desc="${phase_info#*:}"
    if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "$phase" ]; then
        run_phase "$phase" "$desc"
        RESUME_FROM=""
    elif [ "$RESUME_FROM" != "$phase" ]; then
        echo "Skipping $phase"
    fi
done

# Reboot 2
if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "reboot2" ]; then
    echo ""
    echo "========================================"
    echo "READY FOR SECOND REBOOT"
    echo "========================================"
    echo ""
    echo "The system will now reboot into the final btrfs."
    echo "Ansible will wait for the system to come back online."
    echo ""
    read -p "Press Enter to reboot, or Ctrl+C to abort: "

    run_phase "reboot2" "Reboot to final btrfs"

    echo ""
    echo "Second reboot complete. Running cleanup..."
    echo ""
    RESUME_FROM=""
elif [ "$RESUME_FROM" != "reboot2" ]; then
    echo "Skipping reboot2"
fi

# Phase 11
if [ -z "$RESUME_FROM" ] || [ "$RESUME_FROM" = "phase11" ]; then
    run_phase "phase11" "Cleanup and calculate shrink size"
elif [ "$RESUME_FROM" != "phase11" ]; then
    echo "Skipping phase11"
fi

echo ""
echo "========================================"
echo "CONVERSION COMPLETE"
echo "========================================"
echo ""
echo "Check the output above for the AWS disk shrink size."
echo "You can now shrink the EBS volume in AWS to save costs."
echo "Conversion metadata saved to /root/.disk-conversion-metadata-completed.json"
echo ""
