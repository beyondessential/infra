set -euxo pipefail

if [[ ! -f new-instances.json ]]; then
  curl -Lo new-instances.json https://instances.vantage.sh/instances.json
fi

jq 'map({
  instance_type: .instance_type,
  family: .family,
  pretty_name: .pretty_name,
  generation: .generation,
  physical_processor: .physical_processor,
  arch: .arch,
  vCPU: .vCPU,
  memory: .memory,
  burst_minutes: .burst_minutes,
  placement_group_support: .placement_group_support,
  ipv6_support: .ipv6_support,
  enhanced_networking: .enhanced_networking,
  ebs_optimized: .ebs_optimized,
  availability_zones: .availability_zones,
  regions: .regions,
  pricing: .pricing | map_values({
    linux: { ondemand: .linux.ondemand, spot_avg: .linux.spot_avg },
    mswin: { ondemand: .linux.ondemand, spot_avg: .linux.spot_avg },
  }),
} | select(
  (.generation == "current")
  and .enhanced_networking
  and .ipv6_support
  and .ebs_optimized
))' new-instances.json > instances.json

rm new-instances.json
