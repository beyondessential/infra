# Runbook: A cluster upgrade is stuck or pod health is falling

During [update-k8s-cluster](../sops/update-k8s-cluster.md): an add-on or the control plane does not finish, nodes do not roll onto the new AMI, or the healthy-pod percentage in Headlamp falls away from the baseline you noted (more than 5%).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.

## 1. Pod health falling

Stop starting new upgrade steps while it falls. **[diagnose]**

```
kubectl --context=<context> get pods -A --field-selector=status.phase=Pending
kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
kubectl get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
```

Many Pending pods with nodes being replaced is node churn: go to section 3, or [nodes-not-provisioning](nodes-not-provisioning.md) if no replacement node is arriving.
Pods failing while nodes are stable points at the component you just changed: read that component's logs before continuing.

## 2. An add-on or the control plane will not finish

The AWS console does not refresh itself: reload it before concluding anything is stuck.
If an add-on update did not start, check you picked a front version whose back version matches the add-on's current one (same `eksbuild` suffix) and is compatible with the current Kubernetes version.
Errors in the "upgrade insights" panel concern the next Kubernetes version, not this one.
Anything beyond that is an AWS-side failure for a developer with AdminAccess: record the add-on, its versions and the console message.

## 3. Nodes are not rolling after the control-plane upgrade

Karpenter replaces nodes when the `bottlerocket@latest` AMI changes, so nothing happens until EKS publishes one for the new version, and then drift detection takes minutes to an hour. **[diagnose]**
How it rolls, what it respects, and the commands to watch it are in [update a Kubernetes cluster, nodes roll by themselves](../sops/update-k8s-cluster.md#3-nodes-roll-by-themselves).

| evidence | cause | action |
|---|---|---|
| No drift lines, nodes on the old AMI | AMI not published yet, or still inside Karpenter's reconcile interval. | Wait. |
| Drift lines, replacement is slow | The disruption budgets and PodDisruptionBudgets listed in that SOP section are doing their job. | Wait. |
| Only `db-critical` nodes remain on the old AMI | Replacement happens only between 14:00 and 16:00 UTC. | Wait for the window. |
| Only `db-replica` nodes remain | Replica pods carry `karpenter.sh/do-not-disrupt` and are replaced on each restore cycle, so only empty nodes are reclaimed. | Wait for the cycle, or ask a developer. |
| A pod blocks a drain | Its PodDisruptionBudget allows no disruption. | Find the PodDisruptionBudget (`kubectl get pdb -A`); ask the owner before touching it. |

To speed it up, drain individual general nodes with `kubectl drain <node>`: Karpenter provisions a replacement on the new AMI at once. **[dev-OTS]**
Do not drain a `db-critical` or `db-replica` node by hand: a drain taints it `karpenter.sh/disrupted`, which CloudNativePG answers with a switchover.

## Escalate

State is **still-diagnosing** until you know which section applies.
Escalate with the baseline and current pod-health percentages, the step you were on, and the output of the section 1 commands.
Pod health that keeps falling while you wait is the point to wake a developer.
