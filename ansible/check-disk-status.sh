#!/bin/bash
# Disk Status Check Script
# Validates the current disk setup before conversion

set -e

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_NC='\033[0m'

print_header() {
    echo -e "\n${COLOR_BLUE}=== $1 ===${COLOR_NC}"
}

print_success() {
    echo -e "${COLOR_GREEN}✓${COLOR_NC} $1"
}

print_warning() {
    echo -e "${COLOR_YELLOW}⚠${COLOR_NC} $1"
}

print_error() {
    echo -e "${COLOR_RED}✗${COLOR_NC} $1"
}

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo"
    exit 1
fi

print_header "Current Disk Configuration"

echo ""
echo "Block Devices:"
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT | grep -v loop || true

print_header "Mount Points"
echo ""
findmnt -t ext4,btrfs,xfs -o SOURCE,TARGET,FSTYPE,SIZE,USED,USE%,OPTIONS | head -20

print_header "Disk Usage by Mount Point"
echo ""
if mountpoint -q /; then
    echo "/ (root):"
    df -h / | tail -1
    used_root=$(df -BG / | tail -1 | awk '{print $3}' | sed 's/G//')
    echo "  → Used: ${used_root}GB"
fi

if mountpoint -q /var/log; then
    echo ""
    echo "/var/log:"
    df -h /var/log | tail -1
    used_log=$(df -BG /var/log | tail -1 | awk '{print $3}' | sed 's/G//')
    echo "  → Used: ${used_log}GB"
fi

if mountpoint -q /var/lib/postgresql; then
    echo ""
    echo "/var/lib/postgresql:"
    df -h /var/lib/postgresql | tail -1
    used_pg=$(df -BG /var/lib/postgresql | tail -1 | awk '{print $3}' | sed 's/G//')
    echo "  → Used: ${used_pg}GB"
fi

print_header "Total Data Size Calculation"
echo ""
total_used=0
if mountpoint -q /; then
    root_mb=$(df -BM / | tail -1 | awk '{print $3}' | sed 's/M//')
    total_used=$((total_used + root_mb))
fi
if mountpoint -q /var/log; then
    log_mb=$(df -BM /var/log | tail -1 | awk '{print $3}' | sed 's/M//')
    total_used=$((total_used + log_mb))
fi
if mountpoint -q /var/lib/postgresql; then
    pg_mb=$(df -BM /var/lib/postgresql | tail -1 | awk '{print $3}' | sed 's/M//')
    total_used=$((total_used + pg_mb))
fi
total_gb=$(((total_used + 1023) / 1024))

echo "Total used across all partitions: ${total_gb}GB"
needed_intermediate=$((total_gb + 8))
echo "Intermediate partition needed: ${needed_intermediate}GB"
needed_final=$((total_gb + 20))
if [ $needed_final -lt 50 ]; then
    needed_final=50
fi
echo "Final disk size needed: ${needed_final}GB"
min_root_disk=$((needed_intermediate + 15))
echo "Minimum root disk size: ${min_root_disk}GB"

print_header "Root Disk Information"
echo ""
root_device=$(findmnt -n -o SOURCE / | sed 's/p\?[0-9]*$//')
if [ -b "$root_device" ]; then
    echo "Root device: $root_device"
    disk_size_bytes=$(lsblk -b -n -o SIZE "$root_device" | head -1)
    disk_size_gb=$((disk_size_bytes / 1024 / 1024 / 1024))
    echo "Current size: ${disk_size_gb}GB"

    if [ $disk_size_gb -lt $min_root_disk ]; then
        print_error "Root disk is too small! Need at least ${min_root_disk}GB"
        echo "  → Please extend the EBS volume to at least ${min_root_disk}GB before conversion"
    else
        print_success "Root disk size is sufficient (${disk_size_gb}GB >= ${min_root_disk}GB)"
    fi

    echo ""
    echo "Partition table:"
    parted "$root_device" print 2>/dev/null | grep -E '(Partition Table|Number|^ )'
else
    print_error "Could not determine root device"
fi

print_header "Filesystem Types"
echo ""
root_fs=$(findmnt -n -o FSTYPE /)
if [ "$root_fs" = "ext4" ]; then
    print_success "Root is ext4 (expected for conversion)"
elif [ "$root_fs" = "btrfs" ]; then
    print_warning "Root is already btrfs - may already be converted"
else
    print_error "Root is $root_fs (expected ext4)"
fi

if mountpoint -q /var/log; then
    log_fs=$(findmnt -n -o FSTYPE /var/log)
    if [ "$log_fs" = "btrfs" ] || [ "$log_fs" = "ext4" ]; then
        print_success "/var/log is $log_fs (expected)"
    else
        print_warning "/var/log is $log_fs (unexpected)"
    fi
else
    print_error "/var/log is not a separate mount point"
fi

if mountpoint -q /var/lib/postgresql; then
    pg_fs=$(findmnt -n -o FSTYPE /var/lib/postgresql)
    if [ "$pg_fs" = "ext4" ] || [ "$pg_fs" = "btrfs" ]; then
        print_success "/var/lib/postgresql is $pg_fs (expected)"
    else
        print_warning "/var/lib/postgresql is $pg_fs (unexpected)"
    fi
else
    print_error "/var/lib/postgresql is not a separate mount point"
fi

print_header "Service Status"
echo ""
for service in postgresql podman; do
    if systemctl is-active --quiet $service 2>/dev/null; then
        print_success "$service is running"
    else
        print_warning "$service is not running (or not installed)"
    fi
done

print_header "Free Space Check"
echo ""
root_avail=$(df -BG / | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available on root: ${root_avail}GB"
if [ "$root_avail" -gt 5 ]; then
    print_success "Root has sufficient free space"
else
    print_warning "Root partition is very full"
fi

print_header "EFI Boot Check"
echo ""
if [ -d /sys/firmware/efi ]; then
    print_success "System uses EFI boot"
    if mountpoint -q /boot/efi; then
        efi_mount=$(findmnt -n -o SOURCE /boot/efi)
        print_success "EFI partition mounted: $efi_mount"
    else
        print_warning "EFI detected but /boot/efi not mounted"
    fi
else
    print_warning "System uses legacy BIOS boot (less common)"
fi

print_header "Recommendation Summary"
echo ""
if [ $disk_size_gb -ge $min_root_disk ] && [ "$root_fs" = "ext4" ] && mountpoint -q /var/log && mountpoint -q /var/lib/postgresql; then
    print_success "System appears ready for conversion!"
    echo ""
    echo "Next steps:"
    echo "  1. Ensure backups are current"
    echo "  2. Review the conversion guide: ansible/DISK-CONVERSION-GUIDE.md"
    echo "  3. Run: ansible-playbook convert-three-disk-to-btrfs.yml -i inventory/your-inventory.yml -l hostname --tags=phase1"
else
    print_warning "System may not be ready for conversion"
    echo ""
    echo "Issues detected:"
    [ $disk_size_gb -lt $min_root_disk ] && echo "  - Root disk needs to be extended"
    [ "$root_fs" != "ext4" ] && echo "  - Root filesystem is not ext4"
    ! mountpoint -q /var/log && echo "  - /var/log is not a separate mount point"
    ! mountpoint -q /var/lib/postgresql && echo "  - /var/lib/postgresql is not a separate mount point"
fi

echo ""
