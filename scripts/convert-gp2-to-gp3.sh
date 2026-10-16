#!/usr/bin/env bash
#
# convert-gp2-to-gp3.sh — move every gp2 EBS volume in every aws-sso account to gp3.
#
# Dry run by default, using the ReadAccess role. With --apply it uses
# WriteAccess and calls ec2:ModifyVolume, an online change that keeps the size.
#
#   scripts/convert-gp2-to-gp3.sh                      # list what would change
#   scripts/convert-gp2-to-gp3.sh --apply              # convert
#   scripts/convert-gp2-to-gp3.sh --apply --only Demo  # profiles matching a regex
#
# Volumes created by the EBS CSI driver or tagged for Kubernetes are skipped
# unless --include-k8s is given: their PersistentVolumes record no volume type,
# so converting them is safe, but the StorageClass would still say gp2 and a
# restored PVC would come back as gp2.
#
# gp2 volumes over 1,000 GiB have a baseline above gp3's 3,000 IOPS and 125
# MiB/s, and gp2 volumes of 334 GiB or more reach 250 MiB/s. To avoid a
# performance drop the script sets gp3 IOPS and throughput to match
# (--no-preserve-perf disables that).
#
# AWS allows one modification per volume every 6 hours, and rejects volumes
# already being modified. Failures are logged and do not stop the run.
# A TSV log of every volume seen is written to the current directory.

set -euo pipefail

role=ReadAccess
apply=0
include_k8s=0
preserve=1
only=''
inner=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1; role=WriteAccess ;;
    --include-k8s) include_k8s=1 ;;
    --no-preserve-perf) preserve=0 ;;
    --only) only="$2"; shift ;;
    --inner) inner=1; shift; break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ $inner -eq 1 ]]; then
  profile="$1" apply="$2" include_k8s="$3" preserve="$4"
  for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
    aws ec2 describe-volumes --region "$region" --filters Name=volume-type,Values=gp2 --output json 2>/dev/null |
      jq -r --arg r "$region" --argjson k8s "$include_k8s" '
        .Volumes[]
        | . as $v
        | ((.Tags // []) | map(.Key) | any(test("^kubernetes.io/|^ebs.csi.aws.com/|^KubernetesCluster$"))) as $is_k8s
        | [$r, .VolumeId, .Size, .State, (.Attachments | map(.InstanceId) | join(",")), ($is_k8s | tostring)] | @tsv' |
      while IFS=$'\t' read -r r vol size state attached is_k8s; do
        action=convert
        if [[ "$is_k8s" == true && "$include_k8s" -eq 0 ]]; then
          action=skip-k8s
        elif [[ "$state" != available && "$state" != in-use ]]; then
          action="skip-$state"
        fi
        extra=()
        if [[ "$preserve" -eq 1 ]]; then
          iops=$((size * 3)); ((iops > 16000)) && iops=16000
          ((iops > 3000)) && extra+=(--iops "$iops")
          ((size >= 334)) && extra+=(--throughput 250)
        fi
        result=''
        if [[ "$action" == convert && "$apply" -eq 1 ]]; then
          if out=$(aws ec2 modify-volume --region "$r" --volume-id "$vol" --volume-type gp3 "${extra[@]}" \
                     --query 'VolumeModification.ModificationState' --output text 2>&1); then
            result="$out"
          else
            result="FAILED: ${out//$'\n'/ }"
          fi
        fi
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$profile" "$r" "$vol" "$size" "$state" "${attached:--}" "$action" "${extra[*]:--}" "${result:--}"
      done
  done
  exit 0
fi

log="gp2-to-gp3-$(date -u +%Y%m%dT%H%M%SZ).tsv"
printf 'profile\tregion\tvolume\tsize_gib\tstate\tattached_to\taction\textra_args\tresult\n' | tee "$log"

profiles=$(aws-sso list --csv 2>/dev/null | awk -F, -v r="$role" '$3 == r { print $4 }' | sort)
[[ -n "$only" ]] && profiles=$(grep -E "$only" <<<"$profiles" || true)

for p in $profiles; do
  aws-sso exec -p "$p" -- "$0" --inner "$p" "$apply" "$include_k8s" "$preserve" | tee -a "$log" || echo "profile $p failed" >&2
done

echo >&2
echo "log: $log" >&2
awk -F'\t' 'NR > 1 { n[$7]++; if ($7 == "convert") gib += $4 } END { for (a in n) printf "%s: %d\n", a, n[a]; printf "convert total: %d GiB\n", gib }' "$log" >&2
[[ $apply -eq 0 ]] && echo "dry run: nothing changed" >&2
