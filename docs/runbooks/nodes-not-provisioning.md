# Runbook: Pods stay Pending and no node appears, or NodeClasses are not Ready

Pods sit `Pending` with `FailedScheduling`, and Karpenter creates no NodeClaim, or a NodeClaim that never becomes a node.
Or `kubectl get ec2nodeclasses` shows an empty or `Unknown` READY column, and Karpenter provisions no nodes.
Pools, classes and limits: [node pools](../reference/k8s-node-pools.md).
Names and placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

Karpenter is what adds nodes, so a pod waiting on a node that never comes, and a NodeClass that is not `Ready`, both land here.
NodeClasses not Ready is most often seen at [bootstrap](../sops/bootstrap-k8s-cluster.md#6-verify) or after a change to node classes.
If every `ingress` node is gone, the API proxy goes with it: [cluster-api-unreachable](cluster-api-unreachable.md).

## 2. Establish context

Which cluster, which pod and pool, and what changed: a bootstrap, a class or pool change in `k8s-core`, or a node roll. **[diagnose]**

## 3. Investigate

1. **The pending pod, the claims, the pools and the classes.** Note the pod's node selector, affinity and tolerations from `describe`, and whether any NodeClaim is newer than the pod. A healthy cluster shows every NodeClass `Ready=True`, `SubnetsReady=True` and `SecurityGroupsReady=True`, and every NodePool `Ready=True`. **[diagnose]**

```
kubectl --context=<context> get pods -A --field-selector=status.phase=Pending
kubectl --context=<context> describe pod -n <namespace> <pod>
kubectl --context=<context> get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
kubectl --context=<context> get nodepools
kubectl --context=<context> get ec2nodeclasses
```

2. **The controller.** It requires a node labelled `bes.node.purpose=system` and spreads its two replicas over `karpenter.sh/capacity-type` with `DoNotSchedule` ([node pools](../reference/k8s-node-pools.md#bootstrap-nodegroups-and-placeholders)). **[diagnose]**

```
kubectl --context=<context> -n kube-system get pods -l app.kubernetes.io/name=karpenter
kubectl --context=<context> -n kube-system describe pod -l app.kubernetes.io/name=karpenter
kubectl --context=<context> -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=100
```

3. **A NodeClass that is `Unknown`.** **[diagnose]**

```
kubectl --context=<context> get ec2nodeclass workload -o jsonpath='{.status.conditions}' | jq
kubectl --context=<context> -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=80 | grep -iE 'instanceprofile|ValidationError'
```

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Karpenter pods not running; NodeClass READY column empty (no `True` or `False`) | No controller, so nothing writes status and nothing provisions. `describe` shows why the pods are Pending. | The next two rows. |
| Controller Pending: no nodes match the `system` purpose, and `kubectl get nodes -L bes.node.purpose` shows none | The cluster was created with `bootstrap` false, or the bootstrap nodegroups are at zero, so there is no node to start on. | Scale one `bootstrap-system` nodegroup to one ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| Controller Pending: topology spread on `karpenter.sh/capacity-type` not satisfiable, and a bootstrap-system node exists | The node lacks the `karpenter.sh/capacity-type` label. The current code labels bootstrap nodes `on-demand`, so this is a node created before that label was added. | Label the node: `kubectl --context=<context> label node <node> karpenter.sh/capacity-type=on-demand`. **[dev-OTS]** |
| NodeClass not Ready: `InstanceProfileReady=Unknown` with "object is awaiting reconciliation" and `ValidationSucceeded=Unknown` with "Awaiting AMI, Instance Profile, Security Group, and Subnet resolution", while AMIs, subnets and security groups are `True`; the log has a `CreateInstanceProfile` failure with a `ValidationError` about a tag value not matching `[\p{L}\p{Z}\p{N}_.:/=+\-@]*` | Karpenter copies `EC2NodeClass.spec.tags` onto the IAM instance profile it creates, and IAM tag values are stricter than EC2's: no brackets, parentheses, braces, commas, semicolons or quotes. The usual offender is the `Name` tag when it carries brackets. The values come from `namePrefix` and the tag set in `pulumi/k8s-core/karpenter/classes.ts`, plus the tags inherited from the core stack's `tags` config. | Fix the offending tag value in code or in the core stack config, then apply `k8s-core`. **[dev-OTS]** |
| NodeClass `Unknown` with a different error in that grep (for example access denied) | The controller policy `karpenter-controller-policy` in `pulumi/k8s-core/karpenter/controller.ts`. | Escalate with the log lines. |
| Pod needs a purpose with no nodes (`system`, `ingress`) and the `placeholder-*` Deployment is Pending too | The pool cannot provision, or every node of that purpose was lost. | Read the Karpenter log for the launch error; if nothing can launch, recall a bootstrap nodegroup ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| Pod targets a dedicated pool (`db-replica`, `db-critical`) or `tailscale-exit` | The pool's `NoSchedule` taint needs a matching toleration and selector on the pod. A pod without them stays Pending on the general pools. | Fix the pod's scheduling in the stack that owns it. **[dev-OTS]** |
| NodePool at its limit | `kubectl get nodepool <pool> -o jsonpath='{.status.resources}'` is at or above the pool's `limits` (CPU or memory). **[diagnose]** | Raise the limit in `pulumi/k8s-core/karpenter/pools.ts` and apply `k8s-core`. **[dev-OTS]** |
| Karpenter logs show repeated launch failures for spot, and capacity falls back to on-demand | Missing spot service-linked role, or spot capacity for the allowed types unavailable. Check the role with a `ReadAccess` profile: `aws-sso exec -p <profile> -- aws iam get-role --role-name AWSServiceRoleForEC2Spot`. **[diagnose]** | The role is created by `spotServiceLinkedRole` in `pulumi/k8s-core/roles.ts`; an older account where it already exists has to import it rather than recreate it ([spot capacity](../spec/kubernetes/nodes.md#spot-capacity)). While spot launches fail, capacity falls back to the lower-weight on-demand pools. |
| A `db-critical` node is due for replacement but nothing happens | Drift replacement there is one node at a time and only between 14:00 and 16:00 UTC. | Not a fault; wait for the window. |
| A NodeClaim exists but never becomes a node | Launch is failing or the node cannot join. | Read the NodeClaim conditions (`kubectl describe nodeclaim <name>`) **[diagnose]** and the Karpenter log, then escalate with them. |

## 5. Resolve

- Once the controller has a node (nodegroup recalled, or node labelled), one replica schedules on it, provisions a `system-arm-spot` node from its own pool, and the second replica schedules there. NodeClasses should turn `Ready` within a minute or two. **[diagnose]**
- After a tag, limit or class fix is applied through `k8s-core`, Karpenter re-reconciles within seconds and the NodeClasses turn `Ready`. **[diagnose]**
- Keep the floor: the `placeholder-system` and `placeholder-ingress` Deployments exist so that the last `system` or `ingress` node is not lost. While their node lives, Karpenter's consolidator does not remove it, and when it is lost the placeholder goes Pending and triggers a new node. If every `ingress` node is gone, the Tailscale operator goes with it and the API server proxy disappears: [cluster-api-unreachable](cluster-api-unreachable.md).

## 6. Escalate

State is **fix-required** when the cause is a limit, instance-type selection, class setting or tag value: code area `pulumi/k8s-core/karpenter/pools.ts` or `classes.ts`, or the core stack `tags` config.
It is **still-diagnosing** when no launch error is visible.
If there is no `system` node and nobody with AdminAccess can scale a bootstrap nodegroup, escalate to a developer.
Include the pending pod's scheduling message, the NodeClaim list, the NodeClass conditions, and the Karpenter log lines.
