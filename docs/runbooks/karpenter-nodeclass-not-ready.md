# Runbook: Karpenter NodeClasses not Ready

`kubectl get ec2nodeclasses` shows an empty or `Unknown` READY column, and Karpenter provisions no nodes.
Most often seen at [bootstrap](../sops/bootstrap-k8s-cluster.md#6-verify) or after a change to node classes.

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Names and placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

## 1. Confirm

```
kubectl --context=<context> get ec2nodeclasses
kubectl --context=<context> get nodepools
```

**[diagnose]** A healthy cluster shows every NodeClass `Ready=True`, `SubnetsReady=True` and `SecurityGroupsReady=True`, and every NodePool `Ready=True`.

## 2. Interpret

| READY column | meaning | go to |
|---|---|---|
| empty (no `True` or `False`) | The Karpenter controller is not running, so nothing writes status. | [A](#a-controller-not-running) |
| `Unknown` | Karpenter is running and writing status but cannot finish reconciling a NodeClass. | [B](#b-unknown-with-instanceprofile-errors) |

## A. Controller not running

```
kubectl --context=<context> -n kube-system get pods -l app.kubernetes.io/name=karpenter
kubectl --context=<context> -n kube-system describe pod -l app.kubernetes.io/name=karpenter
```

**[diagnose]** If the pods are `Pending`, `describe` shows why.
The controller requires a node labelled `bes.node.purpose=system` and spreads its two replicas over `karpenter.sh/capacity-type` with `DoNotSchedule` ([node pools](../reference/k8s-node-pools.md#bootstrap-nodegroups-and-placeholders)).

| scheduling message | cause | action |
|---|---|---|
| no nodes match the `system` purpose, and `kubectl get nodes -L bes.node.purpose` shows none | The cluster was created with `bootstrap` false, or the bootstrap nodegroups are at zero, so there is no node to start on. | Scale one `bootstrap-system` nodegroup to one ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| topology spread on `karpenter.sh/capacity-type` not satisfiable, and a bootstrap-system node exists | The node lacks the `karpenter.sh/capacity-type` label. The current code labels bootstrap nodes `on-demand`, so this is a node created before that label was added. | Label the node. **[dev-OTS]** `kubectl --context=<context> label node <node> karpenter.sh/capacity-type=on-demand` |

After the label, one replica schedules on that node, provisions a `system-arm-spot` node from its own pool, and the second replica schedules there.
NodeClasses should turn `Ready` within a minute or two. **[diagnose]**

## B. `Unknown` with InstanceProfile errors

```
kubectl --context=<context> get ec2nodeclass workload -o jsonpath='{.status.conditions}' | jq
kubectl --context=<context> -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=80 | grep -iE 'instanceprofile|ValidationError'
```

**[diagnose]** The signature is `InstanceProfileReady=Unknown` with "object is awaiting reconciliation" and `ValidationSucceeded=Unknown` with "Awaiting AMI, Instance Profile, Security Group, and Subnet resolution", while AMIs, subnets and security groups are all `True`.
Confirm in the logs: a `CreateInstanceProfile` failure with a `ValidationError` about a tag value not matching `[\p{L}\p{Z}\p{N}_.:/=+\-@]*`.

Cause: Karpenter copies `EC2NodeClass.spec.tags` onto the IAM instance profile it creates, and IAM tag values are stricter than EC2's: no brackets, parentheses, braces, commas, semicolons or quotes.
The usual offender is the `Name` tag when it carries brackets.
The tag values come from `namePrefix` and the tag set in `pulumi/k8s-core/karpenter/classes.ts`, plus the tags inherited from the core stack's `tags` config.
A different error in that grep (for example access denied) points at the controller policy `karpenter-controller-policy` in `pulumi/k8s-core/karpenter/controller.ts`.

Action: fix the offending tag value in code or in the core stack config, then apply `k8s-core`.
Karpenter re-reconciles within seconds and the NodeClasses turn `Ready`. **[dev-OTS]**

## Escalate

State is **fix-required** for B: code area `pulumi/k8s-core/karpenter/classes.ts` (or the core stack `tags` config).
For A, if there is no `system` node and nobody with AdminAccess can scale a bootstrap nodegroup, escalate to a developer.
If the cluster API is also unreachable, see [cluster-api-unreachable](cluster-api-unreachable.md).
