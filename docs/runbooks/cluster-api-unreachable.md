# Runbook: Cannot reach the cluster API, or a stack refuses to run

`kubectl` over the tailnet hangs, returns 401 or 403, or a Pulumi run stops with an "Incorrect cluster", "Incorrect account" or "No current cluster" error.
Connection setup: [connect-to-k8s-cluster](../sops/connect-to-k8s-cluster.md).
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

A Pulumi refusal naming the account or cluster is a guard, not a fault: it stops a run pointed at the wrong target ([cluster endpoint access](../spec/kubernetes/namespaces.md#cluster-endpoint-access)).
A `kubectl` failure over the tailnet is the API proxy, which the Tailscale operator serves from an `ingress` node, or your own access.

## 2. Establish context

Which cluster, which stack or command failed, and whether anything changed on the ingress nodes or in the tailnet policy. **[diagnose]**

## 3. Investigate

1. **The current context**: `kubectl config current-context`. The tailnet host must match `k8s-operator-<stack>.tail<five hex>.ts.net` where `<stack>` is the full stack name (`pulumi/common/k8s/coreRef.ts`). **[diagnose]**
2. **The operator device** `k8s-operator-<stack>` in the Tailscale admin machines list: online or offline. **[diagnose]**
3. **If the device is offline**, connect directly ([connect-to-k8s-cluster](../sops/connect-to-k8s-cluster.md#directly-with-aws-sso)); you need an AWS identity with an EKS access entry. Then look. **[diagnose]**

```
kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
kubectl --context=<context> -n tailscale-system get pods
kubectl --context=<context> -n kube-system get pods -l app.kubernetes.io/name=karpenter
```

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| `Incorrect account: expected <id> but got <id>` (any stack that references a core, `pulumi/common/coreRef.ts`) | The aws-sso profile in use is for a different account. | Use the profile for this stack's account. |
| `Incorrect cluster: expected <stack> but got <name>` | The kubeconfig points at another cluster's tailnet host. | Select the right context. |
| `Incorrect cluster: expected <endpoint> but got <server>` | The kubeconfig points at neither this cluster's tailnet host nor its EKS endpoint. | Select the right context. |
| `No current cluster`, with "This usually means your kubeconfig is broken" | No current context, or the kubeconfig cannot be read. | Fix `~/.kube/config`. |
| `kubectl` hangs or times out | The Tailscale operator, which serves the API proxy, is not running: its pod needs an `ingress` node. | Check the device (step 2); if it is offline, run step 3 and read the last three rows. |
| 401, or "unauthorized" | Wrong kubeconfig user, or a direct-access kubeconfig whose SSO session has expired. | Use the tailnet context with user `tailscale-auth`. For direct access ask a human to run `aws-sso login`. |
| 403, "forbidden" | Connected, but your access group does not bind that action. Groups come from the tailnet policy ([access groups](../spec/kubernetes/namespaces.md#access-groups)). | Not fixable on the cluster: ask the owner of `beyondessential/tailscale`. |
| No node with `bes.node.purpose=ingress`; operator pod Pending | Every ingress node was lost together. | Let Karpenter replace it ([nodes-not-provisioning](nodes-not-provisioning.md)); if it cannot, recall `bootstrap-ingress` ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| Operator pod running, device offline in Tailscale | The operator cannot authenticate to Tailscale. | Read the operator pod's log: `kubectl --context=<context> -n tailscale-system logs <pod> --tail=50`. **[diagnose]** The identity and tags are in [register-cluster-in-tailscale](../sops/register-cluster-in-tailscale.md). |
| Karpenter pods not running | No controller to replace nodes. | [nodes-not-provisioning](nodes-not-provisioning.md), the controller rows. |

## 5. Resolve

- A guard refusal is resolved by using the right profile or context; nothing on the cluster changes.
- Lost ingress nodes come back through Karpenter or the bootstrap nodegroup recall above. **[dev-OTS]** Once an `ingress` node exists the operator pod schedules and the device comes back online in Tailscale; `kubectl` over the tailnet then answers. **[diagnose]**
- An operator that cannot authenticate needs its identity and tags corrected in the tailnet ([register-cluster-in-tailscale](../sops/register-cluster-in-tailscale.md)). **[dev-OTS]**

## 6. Escalate

State is **fix-required** if the cause is in `pulumi/k8s-essentials/tailscale.ts` or the tailnet policy, and **still-diagnosing** otherwise.
Losing the API proxy blocks every engineer and every Tamanu CD run on that cluster: treat it as a wide-scope incident, and say whether you could reach the cluster directly.
Give the cluster, the error text or the `kubectl` failure, the operator device's state, and the output of the step 3 commands.
