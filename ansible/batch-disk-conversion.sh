#!/bin/bash
# Batch Disk Conversion Script
# Runs disk conversion on multiple servers with proper coordination

set -e

COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'
COLOR_NC='\033[0m'

print_header() {
    echo -e "\n${COLOR_BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
    echo -e "${COLOR_BLUE}  $1${COLOR_NC}"
    echo -e "${COLOR_BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
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

print_info() {
    echo -e "${COLOR_CYAN}ℹ${COLOR_NC} $1"
}

usage() {
    cat << EOF
Batch Disk Conversion Script
=============================

Usage: $0 [OPTIONS]

Options:
  -i, --inventory FILE    Ansible inventory file (required)
  -g, --group GROUP       Target group from inventory (default: disk_conversion)
  -l, --limit PATTERN     Limit to specific hosts (Ansible limit pattern)
  -p, --phase PHASE       Run specific phase (default: interactive)
  -c, --concurrency N     Number of hosts to process in parallel (default: 1)
  -n, --dry-run           Show what would be done without doing it
  -h, --help              Show this help message

Phases:
  all         - Run complete conversion (requires supervision)
  phase1      - Detect devices, calculate parameters, and validate
  phase2-5    - Setup intermediate btrfs
  reboot1     - Reboot to intermediate
  phase7-9    - Setup final btrfs
  reboot2     - Reboot to final
  phase11     - Cleanup
  check       - Just check disk status

Examples:
  # Interactive conversion for all servers in disk_conversion group
  $0 -i inventory/prod.yml

  # Check disk status on specific servers
  $0 -i inventory/prod.yml -l "server1,server2" -p check

  # Run phase1 on all servers in parallel (max 3)
  $0 -i inventory/prod.yml -p phase1 -c 3

  # Run complete conversion on a single server
  $0 -i inventory/prod.yml -l server1 -p all

Safety Notes:
  - Always run 'check' phase first
  - Default concurrency is 1 for safety
  - Each reboot phase waits for previous hosts to complete
  - Intermediate phases can be re-run if they fail

EOF
}

INVENTORY=""
GROUP="disk_conversion"
LIMIT=""
PHASE="interactive"
CONCURRENCY=1
DRY_RUN=false
PLAYBOOK="convert-three-disk-to-btrfs.yml"

while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--inventory)
            INVENTORY="$2"
            shift 2
            ;;
        -g|--group)
            GROUP="$2"
            shift 2
            ;;
        -l|--limit)
            LIMIT="$2"
            shift 2
            ;;
        -p|--phase)
            PHASE="$2"
            shift 2
            ;;
        -c|--concurrency)
            CONCURRENCY="$2"
            shift 2
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [ -z "$INVENTORY" ]; then
    print_error "Inventory file is required"
    usage
    exit 1
fi

if [ ! -f "$INVENTORY" ]; then
    print_error "Inventory file not found: $INVENTORY"
    exit 1
fi

if [ ! -f "$PLAYBOOK" ]; then
    print_error "Playbook not found: $PLAYBOOK"
    echo "Make sure you're running this from the ansible directory"
    exit 1
fi

ANSIBLE_OPTS="-i $INVENTORY"
if [ -n "$LIMIT" ]; then
    ANSIBLE_OPTS="$ANSIBLE_OPTS -l $LIMIT"
elif [ -n "$GROUP" ]; then
    ANSIBLE_OPTS="$ANSIBLE_OPTS -l $GROUP"
fi

get_hosts() {
    uv run ansible $ANSIBLE_OPTS --list-hosts 2>/dev/null | grep -v "hosts (" | sed 's/^[[:space:]]*//'
}

run_ansible() {
    local tags="$1"
    local hosts="$2"

    if [ "$DRY_RUN" = true ]; then
        print_info "DRY RUN: Would run: ansible-playbook $PLAYBOOK $ANSIBLE_OPTS --tags=$tags"
        if [ -n "$hosts" ]; then
            print_info "On hosts: $hosts"
        fi
        return 0
    fi

    local cmd="uv run ansible-playbook $PLAYBOOK $ANSIBLE_OPTS --tags=$tags"
    if [ -n "$hosts" ]; then
        cmd="$cmd -l $hosts"
    fi

    print_info "Running: $cmd"
    eval $cmd
}

check_disk_status() {
    print_header "Checking Disk Status"

    if [ "$DRY_RUN" = true ]; then
        print_info "DRY RUN: Would check disk status on all hosts"
        return 0
    fi

    uv run ansible $ANSIBLE_OPTS -m script -a "check-disk-status.sh" -b
}

run_phase() {
    local phase="$1"
    local description="$2"

    print_header "$description"

    hosts=$(get_hosts)
    if [ -z "$hosts" ]; then
        print_error "No hosts found matching criteria"
        return 1
    fi

    print_info "Target hosts:"
    echo "$hosts" | while read host; do
        echo "  - $host"
    done

    if [ "$CONCURRENCY" -eq 1 ]; then
        run_ansible "$phase" ""
    else
        print_info "Running with concurrency: $CONCURRENCY"
        echo "$hosts" | xargs -P "$CONCURRENCY" -I {} uv run ansible-playbook $PLAYBOOK $ANSIBLE_OPTS -l {} --tags="$phase"
    fi
}

run_interactive() {
    print_header "Batch Disk Conversion - Interactive Mode"

    hosts=$(get_hosts)
    if [ -z "$hosts" ]; then
        print_error "No hosts found"
        exit 1
    fi

    print_info "Target hosts:"
    echo "$hosts" | while read host; do
        echo "  - $host"
    done
    echo ""

    print_header "Phase 1: Detecting Devices, Calculating Parameters, and Validating"
    run_ansible "phase1" ""

    echo ""
    print_header "DISK SPACE REQUIREMENTS"
    echo ""
    print_warning "Review the disk space calculations and partition tables above for each host"
    print_info "You need to extend the root EBS volume to the 'Total disk space needed' size shown"
    echo ""
    read -p "Have you extended the root EBS volumes for all these hosts to the required size? (yes/no): " answer
    if [ "$answer" != "yes" ]; then
        print_warning "Please extend the root EBS volumes first"
        print_info "You can resume from phase2 with: $0 -i $INVENTORY -l <hosts> -p phase2"
        exit 1
    fi

    echo ""
    print_warning "Review the output above carefully for each host"
    read -p "Continue with conversion? (yes/no): " answer
    if [ "$answer" != "yes" ]; then
        print_info "Conversion cancelled"
        exit 0
    fi

    print_header "Phases 2-5: Setting up Intermediate BTRFS"
    for phase in phase2 phase3 phase4 phase5; do
        run_ansible "$phase" ""
    done

    print_header "First Reboot"
    print_warning "About to reboot all hosts to intermediate btrfs"
    read -p "Continue? (yes/no): " answer
    if [ "$answer" != "yes" ]; then
        print_info "Stopped before reboot. You can resume later with --phase reboot1"
        exit 0
    fi

    run_ansible "reboot1" ""

    print_success "First reboot complete. Servers are running on intermediate btrfs."
    sleep 5

    print_header "Phases 7-9: Setting up Final BTRFS"
    for phase in phase7 phase8 phase9; do
        run_ansible "$phase" ""
    done

    print_header "Second Reboot"
    print_warning "About to reboot all hosts to final btrfs"
    read -p "Continue? (yes/no): " answer
    if [ "$answer" != "yes" ]; then
        print_info "Stopped before second reboot. You can resume later with --phase reboot2"
        exit 0
    fi

    run_ansible "reboot2" ""

    print_success "Second reboot complete. Servers are running on final btrfs."
    sleep 5

    print_header "Phase 11: Cleanup"
    run_ansible "phase11" ""

    print_header "Conversion Complete!"
    print_success "All hosts have been successfully converted to single-root btrfs"
    echo ""
    print_info "Next steps:"
    echo "  1. Verify services on all hosts"
    echo "  2. Review the AWS shrink sizes from phase11 output"
    echo "  3. Shrink EBS volumes in AWS"
    echo "  4. Detach and delete old /var/log and /var/lib/postgresql volumes"
}

run_all_phases() {
    print_header "Running All Phases Sequentially"

    print_warning "This will run the complete conversion without interaction"
    read -p "Are you sure? (yes/no): " answer
    if [ "$answer" != "yes" ]; then
        exit 0
    fi

    for phase in phase1 phase2 phase3 phase4 phase5; do
        run_phase "$phase" "Running $phase"
    done

    run_phase "reboot1" "First Reboot"
    sleep 30

    for phase in phase7 phase8 phase9; do
        run_phase "$phase" "Running $phase"
    done

    run_phase "reboot2" "Second Reboot"
    sleep 30

    run_phase "phase11" "Cleanup"

    print_success "All phases completed successfully"
}

case "$PHASE" in
    interactive)
        run_interactive
        ;;
    all)
        run_all_phases
        ;;
    check)
        check_disk_status
        ;;
    phase1|phase2|phase3|phase4|phase5|phase7|phase8|phase9|phase11|reboot1|reboot2)
        run_phase "$PHASE" "Running $PHASE"
        ;;
    *)
        print_error "Unknown phase: $PHASE"
        usage
        exit 1
        ;;
esac

print_success "Done"
