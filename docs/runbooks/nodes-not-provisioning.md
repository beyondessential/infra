# Runbook: Pods stay Pending and no node appears

Pods sit `Pending` with `FailedScheduling`, and Karpenter creates no NodeClaim, or a NodeClaim that never becomes a node.
If NodeClasses are not `Ready`, use [karpenter-nodeclass-not-ready](karpenter-nodeclass-not-ready.md) first.

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Pools, classes and limits: [node pools](../reference/k8s-node-pools.md).

## 1. Confirm

```
kubectl --context=<context> get pods -A --field-selector=status.phase=Pending
kubectl --context=<context> describe pod -n <namespace> <pod>
kubectl --context=<context> get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
kubectl --context=<context> get nodepools
kubectl --context=<context> -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=100
```

**[diagnose]** Note the pod's node selector, affinity and tolerations from `describe`, and whether any NodeClaim is newer than the pod.

## 2. Interpret

| evidence | cause | action |
|---|---|---|
| Karpenter pods not running | No controller. | [karpenter-nodeclass-not-ready](karpenter-nodeclass-not-ready.md#a-controller-not-running) |
| Pod needs a purpose with no nodes (`system`, `ingress`) and the `placeholder-*` Deployment is Pending too | The pool cannot provision, or every node of that purpose was lost. | Read the Karpenter log for the launch error; if nothing can launch, recall a bootstrap nodegroup ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| Pod targets a dedicated pool (`db-replica`, `db-critical`) or `tailscale-exit` | The pool's `NoSchedule` taint needs a matching toleration and selector on the pod. A pod without them stays Pending on the general pools. | Fix the pod's scheduling in the stack that owns it. |
| NodePool at its limit | `kubectl get nodepool <pool> -o jsonpath='{.status.resources}'` is at or above the pool's `limits` (CPU or memory). **[diagnose]** | Raise the limit in `pulumi/k8s-core/karpenter/pools.ts` and apply `k8s-core`. **[dev-OTS]** |
| Karpenter logs show repeated launch failures for spot, and capacity falls back to on-demand | Missing spot service-linked role, or spot capacity for the allowed types unavailable. Check the role with a `ReadAccess` profile: `aws-sso exec -p <profile> -- aws iam get-role --role-name AWSServiceRoleForEC2Spot`. **[diagnose]** | The role is created by `spotServiceLinkedRole` in `pulumi/k8s-core/roles.ts`; an older account where it already exists has to import it rather than recreate it ([spot capacity](../spec/kubernetes/nodes.md#spot-capacity)). While spot launches fail, capacity falls back to the lower-weight on-demand pools. |
| A `db-critical` node is due for replacement but nothing happens | Drift replacement there is one node at a time and only between 14:00 and 16:00 UTC. | Not a fault; wait for the window. |
| A NodeClaim exists but never becomes a node | Launch is failing or the node cannot join. | Read the NodeClaim conditions (`kubectl describe nodeclaim <name>`) and the Karpenter log, then escalate with them. |

## 3. Keep the floor

If every `ingress` node is gone, the Tailscale operator goes with it and the API server proxy disappears: [cluster-api-unreachable](cluster-api-unreachable.md).
The `placeholder-system` and `placeholder-ingress` Deployments exist to stop that: while their node lives, Karpenter's consolidator does not remove it, and when it is lost the placeholder goes Pending and triggers a new node.

## Escalate

State is **fix-required** when the cause is a limit, instance-type selection or class setting: code area `pulumi/k8s-core/karpenter/pools.ts` or `classes.ts`.
It is **still-diagnosing** when no launch error is visible.
Include the pending pod's scheduling message, the NodeClaim list, and the Karpenter log lines.
