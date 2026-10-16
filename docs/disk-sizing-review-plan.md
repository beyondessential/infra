# Disk Sizing Review

Re-investigate node disk sizes once Karpenter has been running long enough to gather meaningful data (suggest: 4+ weeks after Phase 5 of the Karpenter migration ships).

## Context

The Karpenter migration set per-NodeClass disk sizes from a one-shot snapshot of the pre-migration cluster:

| NodeClass | Disk | Peak observed pre-migration |
|---|---|---|
| workload | 60Gi | 81% of 50Gi (= 40Gi) on 14 spot nodes |
| ingress | 15Gi | 19% of 25Gi (= 5Gi) |
| system | 15Gi | 19% of 25Gi (= 5Gi) |

Karpenter packs nodes denser via consolidation, so per-node usage post-migration will likely be higher than pre-migration. The 60Gi workload sizing was chosen with headroom but was based on managed-nodegroup behaviour, not Karpenter's.

The pre-migration data also flagged a separate concern: the 81%-disk workload node carried 31Gi of image cache, suggesting either heavy image churn or accumulated stale versions. Default kubelet image GC kicks in at `imageGCHighThresholdPercent: 85` — close to where we were.

## Goals

1. Confirm or revise the 60/15/15 choices against post-Karpenter steady-state data.
2. Decide whether kubelet image GC needs explicit tuning (lower threshold, shorter `imageMinimumGCAge`) or whether the 60Gi workload disk makes it moot.
3. Catch any disk-pressure eviction events that happened during/after the migration.

## Investigation Steps

1. **Pull current per-node fs/imageFs usage**, same as the pre-migration snapshot:

   ```fish
   kubectl get nodes -o json | jq -r '.items[].metadata.name' | while read node
     kubectl get --raw "/api/v1/nodes/$node/proxy/stats/summary" | \
       jq -r --arg n "$node" '.node | [$n, .fs.capacityBytes, .fs.usedBytes, .runtime.imageFs.usedBytes] | @tsv'
   end
   ```

   Aggregate by `bes.node.purpose` label. Compare peak/median/p90 against the pre-migration table.

2. **Check disk-pressure events** since migration:

   ```fish
   kubectl get events -A --field-selector reason=EvictionThresholdMet,reason=NodeHasDiskPressure --sort-by=.lastTimestamp
   ```

   Cross-reference with Karpenter's `karpenter_disruption_*` metrics and node lifetimes — Karpenter terminating nodes for spot/consolidation reasons will mask this.

3. **Image cache breakdown** on the busiest workload nodes (top 3 by `imageFs.usedBytes`):

   ```fish
   # Spawn a debug pod with host filesystem access
   kubectl debug node/<name> -it --image=alpine -- chroot /host /bin/sh
   # Then inspect /var/lib/containerd or equivalent on Bottlerocket
   ```

   Look for: duplicate image versions, oversized base images, application images that grew significantly.

4. **Check kubelet GC behaviour**: are evictions happening and freeing space, or is space accumulating? Bottlerocket exposes kubelet config via `apiclient`; check `imageGCHighThresholdPercent` / `imageGCLowThresholdPercent` / `imageMinimumGCAge` defaults are still appropriate.

## Decision Matrix

| Observation | Action |
|---|---|
| Workload p90 < 40Gi, no disk-pressure events | Drop workload to 40–45Gi; save ~$1.50/node/mo |
| Workload p90 ≥ 50Gi or any disk-pressure events | Hold at 60Gi; tune kubelet GC to be more aggressive |
| Image cache dominates (>70% of fs used) consistently | Tune kubelet `imageGCHighThresholdPercent` down to 75; revisit in another month |
| Ingress/system p90 < 8Gi | Hold at 15Gi (already minimal) |
| Ingress/system p90 ≥ 12Gi | Bump to 20Gi |

## Out of Scope

- NodeClass restructuring (e.g. splitting workload into small/large) — defer to a separate plan if needed.
- Migrating off Bottlerocket — separate concern.

## Output

If sizes change: PR updating `pulumi/k8s-core/karpenter/classes.ts`, plus a follow-up Karpenter rollout (NodeClass changes don't auto-replace nodes; will drift in over consolidation cycles).

If kubelet GC tuning is needed: PR updating Bottlerocket user-data (or whatever path k8s-core uses to set kubelet config — verify at investigation time).

## Exit

Whatever the outcome (resize, GC tune, or no change), the closing action is **always the same**: record the steady-state numbers as a comment in `classes.ts` for the next person, and `/schedule` another disk-sizing review six months out — pointing at this same plan file. Then delete this file (`unplan`).

The intent is a recurring six-monthly re-check that survives Claude conversations and team handover: the plan re-creates itself each cycle by virtue of the previous cycle scheduling the next one.
