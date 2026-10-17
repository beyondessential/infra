# Runbook: A cluster upgrade is stuck or pod health is falling

During [update-k8s-cluster](../sops/update-k8s-cluster.md): an add-on or the control plane does not finish, nodes do not roll onto the new AMI, or the healthy-pod percentage in Headlamp falls away from the baseline you noted (more than 5%).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

A step of that SOP is in progress or has just finished.
Stop starting new upgrade steps while pod health falls.
Pending pods with no replacement node arriving at all is [nodes-not-provisioning](nodes-not-provisioning.md).

## 2. Establish context

Which cluster, which step of the SOP you are on, the baseline pod-health percentage from [its baseline step](../sops/update-k8s-cluster.md#0-baseline), and which component changed last. **[diagnose]**

## 3. Investigate

1. **Pending pods, nodes and NodeClaims.** **[diagnose]**

```
kubectl --context=<context> get pods -A --field-selector=status.phase=Pending
kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
kubectl get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
```

2. **The AWS console, reloaded**: it does not refresh itself, so reload it before concluding anything is stuck. **[diagnose]**
3. **Drift and replacement progress**, with the commands in [update a Kubernetes cluster, nodes roll by themselves](../sops/update-k8s-cluster.md#3-nodes-roll-by-themselves). **[diagnose]**
4. **The logs of the component you just changed**, when pods fail while nodes are stable. **[diagnose]**

## 4. Interpret

Karpenter replaces nodes when the `bottlerocket@latest` AMI changes, so nothing happens until EKS publishes one for the new version, and then drift detection takes minutes to an hour.
How it rolls and what it respects is in that SOP section.

| Evidence | Diagnosis | Action |
|---|---|---|
| Many Pending pods while nodes are being replaced | Node churn from the roll. | Watch the roll (rows below); if no replacement node is arriving, [nodes-not-provisioning](nodes-not-provisioning.md). |
| Pods failing while nodes are stable | The component you just changed. | Read its logs before continuing. |
| An add-on update did not start | The chosen front version does not fit: its back version must match the add-on's current one (same `eksbuild` suffix) and be compatible with the current Kubernetes version. | Pick a version that fits in the console. **[dev-OTS]** |
| Errors in the "upgrade insights" panel | They concern the next Kubernetes version, not this one. | Nothing for this upgrade. |
| An add-on or the control plane will not finish, after a reload | An AWS-side failure for a developer with AdminAccess. | Escalate with the add-on, its versions and the console message. |
| No drift lines, nodes on the old AMI | AMI not published yet, or still inside Karpenter's reconcile interval. | Wait. |
| Drift lines, replacement is slow | The disruption budgets and PodDisruptionBudgets listed in that SOP section are doing their job. | Wait. |
| Only `db-critical` nodes remain on the old AMI | Replacement happens only between 14:00 and 16:00 UTC. | Wait for the window. |
| Only `db-replica` nodes remain | Replica pods carry `karpenter.sh/do-not-disrupt` and are replaced on each restore cycle, so only empty nodes are reclaimed. | Wait for the cycle, or ask a developer. |
| A pod blocks a drain | Its PodDisruptionBudget allows no disruption. | Find the PodDisruptionBudget (`kubectl get pdb -A`) **[diagnose]**; ask the owner before touching it. |

## 5. Resolve

- To speed the roll up, drain individual general nodes with `kubectl drain <node>`: Karpenter provisions a replacement on the new AMI at once. **[dev-OTS]**
- Do not drain a `db-critical` or `db-replica` node by hand: a drain taints it `karpenter.sh/disrupted`, which CloudNativePG answers with a switchover.
- Resume the SOP once pod health is back at the baseline. **[diagnose]**

## 6. Escalate

State is **still-diagnosing** until you know which row applies.
Escalate with the baseline and current pod-health percentages, the step you were on, and the output of the step 1 commands.
Pod health that keeps falling while you wait is the point to wake a developer.
