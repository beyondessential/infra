#!/bin/bash
# AWS EBS Volume Extension Helper
# Extends root EBS volumes across multiple instances in preparation for disk conversion

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
AWS EBS Volume Extension Helper
================================

This script helps extend root EBS volumes across multiple EC2 instances
in preparation for the disk conversion process.

Usage: $0 [OPTIONS]

Options:
  -p, --profile PROFILE      AWS profile to use (supports aws-sso)
  -i, --instance-ids FILE    File containing instance IDs (one per line)
  -I, --instance-id ID       Single instance ID
  -t, --tag KEY=VALUE        Filter instances by tag
  -s, --size SIZE            Target size in GB (default: 100)
  -n, --dry-run              Show what would be done without doing it
  -w, --wait                 Wait for volume modifications to complete
  -h, --help                 Show this help message

Examples:
  # Extend root volumes for instances in a file
  $0 -p fiji-prod:ReadAccess -i instances.txt -s 100

  # Extend single instance
  $0 -p fiji-prod:ReadAccess -I i-1234567890abcdef0 -s 120

  # Find instances by tag and extend (dry-run)
  $0 -p fiji-prod:ReadAccess -t "Name=*postgres*" -s 100 -n

  # Extend and wait for completion
  $0 -p fiji-prod:ReadAccess -i instances.txt -s 100 -w

Workflow:
  1. Lists instances and their root volumes
  2. Shows current and target sizes
  3. Confirms before proceeding
  4. Extends each volume
  5. Optionally waits for completion

Notes:
  - Only extends volumes smaller than target size
  - Uses aws-sso for authentication if profile matches pattern
  - Root volume is detected automatically (/dev/xvda or /dev/sda1)
  - Volume modification is online (no instance restart needed)
  - You can only extend a volume once every 6 hours

EOF
}

AWS_PROFILE=""
INSTANCE_IDS_FILE=""
SINGLE_INSTANCE=""
TAG_FILTER=""
TARGET_SIZE=100
DRY_RUN=false
WAIT_FOR_COMPLETION=false
USE_AWS_SSO=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--profile)
            AWS_PROFILE="$2"
            if [[ "$AWS_PROFILE" == *":"* ]]; then
                USE_AWS_SSO=true
            fi
            shift 2
            ;;
        -i|--instance-ids)
            INSTANCE_IDS_FILE="$2"
            shift 2
            ;;
        -I|--instance-id)
            SINGLE_INSTANCE="$2"
            shift 2
            ;;
        -t|--tag)
            TAG_FILTER="$2"
            shift 2
            ;;
        -s|--size)
            TARGET_SIZE="$2"
            shift 2
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -w|--wait)
            WAIT_FOR_COMPLETION=true
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

if [ -z "$AWS_PROFILE" ]; then
    print_error "AWS profile is required"
    usage
    exit 1
fi

aws_cmd() {
    if [ "$USE_AWS_SSO" = true ]; then
        aws-sso exec -p "$AWS_PROFILE" -- aws "$@"
    else
        aws --profile "$AWS_PROFILE" "$@"
    fi
}

get_instance_ids() {
    if [ -n "$SINGLE_INSTANCE" ]; then
        echo "$SINGLE_INSTANCE"
    elif [ -n "$INSTANCE_IDS_FILE" ]; then
        if [ ! -f "$INSTANCE_IDS_FILE" ]; then
            print_error "Instance IDs file not found: $INSTANCE_IDS_FILE"
            exit 1
        fi
        grep -v '^#' "$INSTANCE_IDS_FILE" | grep -v '^[[:space:]]*$'
    elif [ -n "$TAG_FILTER" ]; then
        IFS='=' read -r tag_key tag_value <<< "$TAG_FILTER"
        aws_cmd ec2 describe-instances \
            --filters "Name=tag:${tag_key},Values=${tag_value}" "Name=instance-state-name,Values=running" \
            --query 'Reservations[].Instances[].InstanceId' \
            --output text | tr '\t' '\n'
    else
        print_error "Must specify instance IDs via -i, -I, or -t"
        usage
        exit 1
    fi
}

get_root_volume_id() {
    local instance_id="$1"
    aws_cmd ec2 describe-instances \
        --instance-ids "$instance_id" \
        --query 'Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName==`/dev/xvda` || DeviceName==`/dev/sda1`].Ebs.VolumeId' \
        --output text
}

get_volume_info() {
    local volume_id="$1"
    aws_cmd ec2 describe-volumes \
        --volume-ids "$volume_id" \
        --query 'Volumes[0].[Size,State,VolumeType]' \
        --output text
}

get_instance_name() {
    local instance_id="$1"
    aws_cmd ec2 describe-instances \
        --instance-ids "$instance_id" \
        --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value' \
        --output text
}

extend_volume() {
    local volume_id="$1"
    local new_size="$2"

    if [ "$DRY_RUN" = true ]; then
        print_info "DRY RUN: Would modify volume $volume_id to ${new_size}GB"
        return 0
    fi

    aws_cmd ec2 modify-volume \
        --volume-id "$volume_id" \
        --size "$new_size" \
        --output json > /dev/null
}

wait_for_volume_modification() {
    local volume_id="$1"
    local max_wait=300
    local waited=0

    print_info "Waiting for volume $volume_id to finish modification..."

    while [ $waited -lt $max_wait ]; do
        state=$(aws_cmd ec2 describe-volumes-modifications \
            --volume-ids "$volume_id" \
            --query 'VolumesModifications[0].ModificationState' \
            --output text 2>/dev/null || echo "unknown")

        if [ "$state" = "completed" ] || [ "$state" = "optimizing" ]; then
            print_success "Volume modification completed"
            return 0
        elif [ "$state" = "failed" ]; then
            print_error "Volume modification failed"
            return 1
        fi

        sleep 5
        waited=$((waited + 5))
        echo -n "."
    done

    echo ""
    print_warning "Timeout waiting for volume modification (it may still complete)"
    return 0
}

print_header "AWS EBS Volume Extension"

print_info "Profile: $AWS_PROFILE"
print_info "Target size: ${TARGET_SIZE}GB"
if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN MODE - No changes will be made"
fi

print_header "Gathering Instance Information"

instance_ids=$(get_instance_ids)
if [ -z "$instance_ids" ]; then
    print_error "No instances found"
    exit 1
fi

instance_count=$(echo "$instance_ids" | wc -l)
print_info "Found $instance_count instance(s)"
echo ""

declare -a instances_to_extend
declare -a volumes_to_extend
declare -a current_sizes

while IFS= read -r instance_id; do
    [ -z "$instance_id" ] && continue

    instance_name=$(get_instance_name "$instance_id")
    volume_id=$(get_root_volume_id "$instance_id")

    if [ -z "$volume_id" ]; then
        print_error "Could not find root volume for $instance_id ($instance_name)"
        continue
    fi

    read -r current_size state vol_type <<< $(get_volume_info "$volume_id")

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Instance:     $instance_id"
    echo "Name:         $instance_name"
    echo "Root Volume:  $volume_id"
    echo "Current Size: ${current_size}GB"
    echo "Volume Type:  $vol_type"
    echo "State:        $state"

    if [ "$current_size" -ge "$TARGET_SIZE" ]; then
        print_success "Already at or above target size (${TARGET_SIZE}GB)"
        echo ""
        continue
    fi

    if [ "$state" != "in-use" ]; then
        print_warning "Volume is not in-use (state: $state)"
        echo ""
        continue
    fi

    print_warning "Will extend from ${current_size}GB to ${TARGET_SIZE}GB"
    echo ""

    instances_to_extend+=("$instance_id:$instance_name")
    volumes_to_extend+=("$volume_id")
    current_sizes+=("$current_size")

done <<< "$instance_ids"

if [ ${#volumes_to_extend[@]} -eq 0 ]; then
    print_info "No volumes need to be extended"
    exit 0
fi

print_header "Summary"
echo ""
echo "Volumes to extend: ${#volumes_to_extend[@]}"
for i in "${!volumes_to_extend[@]}"; do
    IFS=':' read -r inst_id inst_name <<< "${instances_to_extend[$i]}"
    echo "  - ${volumes_to_extend[$i]} (${current_sizes[$i]}GB → ${TARGET_SIZE}GB) - $inst_name"
done
echo ""

if [ "$DRY_RUN" = true ]; then
    print_info "DRY RUN: No changes will be made"
    exit 0
fi

read -p "Proceed with extending these volumes? (yes/no): " answer
if [ "$answer" != "yes" ]; then
    print_info "Cancelled"
    exit 0
fi

print_header "Extending Volumes"

failed_count=0
for i in "${!volumes_to_extend[@]}"; do
    volume_id="${volumes_to_extend[$i]}"
    IFS=':' read -r inst_id inst_name <<< "${instances_to_extend[$i]}"

    echo ""
    print_info "Extending $volume_id ($inst_name)..."

    if extend_volume "$volume_id" "$TARGET_SIZE"; then
        print_success "Volume extension started"

        if [ "$WAIT_FOR_COMPLETION" = true ]; then
            wait_for_volume_modification "$volume_id"
        fi
    else
        print_error "Failed to extend volume $volume_id"
        failed_count=$((failed_count + 1))
    fi
done

print_header "Summary"

extended_count=$((${#volumes_to_extend[@]} - failed_count))
print_success "Successfully extended $extended_count volume(s)"

if [ $failed_count -gt 0 ]; then
    print_error "Failed to extend $failed_count volume(s)"
fi

if [ "$WAIT_FOR_COMPLETION" = false ]; then
    echo ""
    print_info "Volume modifications are in progress"
    print_info "Check status with: aws ec2 describe-volumes-modifications --volume-ids <volume-id>"
    print_info "Or wait for them with: $0 --profile $AWS_PROFILE --instance-ids ... --wait"
fi

echo ""
print_info "Next steps:"
echo "  1. Wait for volume modifications to complete (can take a few minutes)"
echo "  2. Verify extended volumes with: ssh <instance> 'lsblk'"
echo "  3. Run the disk conversion playbook"
echo ""

if [ $failed_count -gt 0 ]; then
    exit 1
fi
