# Runbook: HNC pods not starting, or writes rejected by HNC webhooks

The `hnc-system` pods are not Ready, or creating and changing objects in Tamanu namespaces fails with an admission webhook error naming `hnc.x-k8s.io`.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

HNC's validating webhooks fail closed: while they cannot answer, changes in every namespace HNC manages are refused ([hierarchy controller](../spec/kubernetes/namespaces.md#hierarchy-controller)).
Treat it as wide-scope, because every deployment namespace is affected.
The pods are the manager (`hnc-controller-manager`, one replica) and the webhooks (`hnc-controller-webhooks`, two replicas, no two in one zone).

## 2. Establish context

Which cluster, whether writes are being refused or only a pod is down, and what changed last: a node roll, a cert-manager change, or a change under `pulumi/k8s-essentials/hnc/`. **[diagnose]**

## 3. Investigate

```
kubectl --context=<context> -n hnc-system get pods
kubectl --context=<context> -n hnc-system describe pod <pod>
kubectl --context=<context> -n hnc-system logs <pod> -c build
kubectl --context=<context> -n hnc-system get certificate
```

**[diagnose]** HNC's upstream image is amd64 only, so each pod's init container `build` clones the HNC source from GitHub and compiles it for the node's architecture before the main container starts ([versions](../reference/k8s-component-versions.md#not-pinned)).

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| `Init:Error` or `Init:CrashLoopBackOff`; `build` log shows a `git clone` failure | `github.com` is unreachable from the node when the pod starts. | Restore egress, then restart the pod (section 5). |
| `build` init container `OOMKilled` | The compile exceeded its 2Gi limit. | Escalate: fix in `pulumi/k8s-essentials/hnc/specs.ts`. |
| `Init` is running for a long time but progressing | The compile takes a while on cold start; the startup probe allows for it. | Wait. |
| Pod stuck `ContainerCreating`, event names the secret `webhook-server-cert` | The serving certificate has not been issued: the self-signed Issuer or cert-manager is not working. `get certificate` shows `READY` false. | Fix cert-manager first (`kubectl -n cert-manager get pods` **[diagnose]**). **[dev-OTS]** |
| One webhooks pod Pending, the other Running | Required anti-affinity by zone, and no `system` node in a second zone. | The remaining pod still answers, but the cluster has lost its redundancy: see [nodes-not-provisioning](nodes-not-provisioning.md). |
| Both webhooks pods down | Writes in managed namespaces are refused. | Restart (section 5); escalate at once if they do not come back. |

## 5. Resolve

Restart a pod by deleting it. **[dev-OTS]**

```
kubectl --context=<context> -n hnc-system delete pod <pod>
```

Do not remove or edit the webhook configurations to unblock writes: that is outside this runbook, and a developer decides it.
The first command of section 3 shows every pod Ready once the restart has worked. **[diagnose]**

## 6. Escalate

State is **workaround-in-place** only once at least one webhooks pod answers.
Otherwise **still-diagnosing**, or **fix-required** with the code area `pulumi/k8s-essentials/hnc/` when the cause is the build.
Give the cluster, the pod states, the `build` log or the event text, and whether writes are being refused.
HNC is archived upstream, and the direction is to move off it ([plan](../plans/hnc-to-kyverno-migration-plan.md)).
