# Runbook: Cannot reach the cluster API, or a stack refuses to run

`kubectl` over the tailnet hangs, returns 401 or 403, or a Pulumi run stops with an "Incorrect cluster", "Incorrect account" or "No current cluster" error.
Connection setup: [connect-to-k8s-cluster](../sops/connect-to-k8s-cluster.md).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).

## 1. Pulumi refuses to run

These are guards, not faults: they stop a run pointed at the wrong target ([cluster endpoint access](../spec/kubernetes/namespaces.md#cluster-endpoint-access)).

| message | meaning | fix |
|---|---|---|
| `Incorrect account: expected <id> but got <id>` (any stack that references a core, `pulumi/common/coreRef.ts`) | The aws-sso profile in use is for a different account. | Use the profile for this stack's account. |
| `Incorrect cluster: expected <stack> but got <name>` | The kubeconfig points at another cluster's tailnet host. | Select the right context. **[diagnose]** `kubectl config current-context` |
| `Incorrect cluster: expected <endpoint> but got <server>` | The kubeconfig points at neither this cluster's tailnet host nor its EKS endpoint. | Select the right context. |
| `No current cluster`, with "This usually means your kubeconfig is broken" | No current context, or the kubeconfig cannot be read. | Fix `~/.kube/config`. |

The tailnet host must match `k8s-operator-<stack>.tail<five hex>.ts.net` where `<stack>` is the full stack name (`pulumi/common/k8s/coreRef.ts`).

## 2. kubectl over the tailnet fails

| symptom | likely cause | action |
|---|---|---|
| Hangs or times out | The Tailscale operator, which serves the API proxy, is not running: its pod needs an `ingress` node. | Check the device `k8s-operator-<stack>` in the Tailscale admin machines list. If it is offline, go to section 3. |
| 401, or "unauthorized" | Wrong kubeconfig user, or you are using a direct-access kubeconfig whose SSO session has expired. | Use the tailnet context with user `tailscale-auth`. For direct access ask a human to run `aws-sso login`. |
| 403, "forbidden" | You are connected but your access group does not bind that action. | Not fixable on the cluster: groups come from the tailnet policy ([access groups](../spec/kubernetes/namespaces.md#access-groups)). Ask the owner of `beyondessential/tailscale`. |

## 3. The operator or the ingress nodes are gone

Connect directly ([connect-to-k8s-cluster](../sops/connect-to-k8s-cluster.md#directly-with-aws-sso)); you need an AWS identity with an EKS access entry.
Then look. **[diagnose]**

```
kubectl --context=<context> get nodes -L bes.node.group,bes.node.purpose
kubectl --context=<context> -n tailscale-system get pods
kubectl --context=<context> -n kube-system get pods -l app.kubernetes.io/name=karpenter
```

| evidence | cause | action |
|---|---|---|
| No node with `bes.node.purpose=ingress`; operator pod Pending | Every ingress node was lost together. | Let Karpenter replace it ([nodes-not-provisioning](nodes-not-provisioning.md)); if it cannot, recall `bootstrap-ingress` ([scale-bootstrap-nodegroups](../sops/scale-bootstrap-nodegroups.md#recall-as-a-recovery-handle)). **[dev-OTS]** |
| Operator pod running, device offline in Tailscale | The operator cannot authenticate to Tailscale. | Read the log of the operator pod listed by the second command (`kubectl --context=<context> -n tailscale-system logs <pod> --tail=50`). The identity and tags are in [register-cluster-in-tailscale](../sops/register-cluster-in-tailscale.md). |
| Karpenter pods not running | No controller to replace nodes. | [karpenter-nodeclass-not-ready](karpenter-nodeclass-not-ready.md#a-controller-not-running) |

## Escalate

State is **fix-required** if the cause is in `pulumi/k8s-essentials/tailscale.ts` or the tailnet policy, and **still-diagnosing** otherwise.
Losing the API proxy blocks every engineer and every Tamanu CD run on that cluster: treat it as a wide-scope incident, and say whether you could reach the cluster directly.
