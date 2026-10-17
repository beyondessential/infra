# Runbook: the update is refused before anything changes

`pulumi up` (or Tamanu CD's up job) fails fast with a message from the stub, before the Application is touched.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The error is one of the messages below, raised while the program starts.
A failure after the Application exists is a [sync failure](argo-sync-failed.md), a [stuck sync](application-stuck-progressing.md) or a [render error](render-error.md).

## 2. Establish context

Which stack, which cluster the kubeconfig points at, and whether the deployment is new or came from the previous program: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Interpret

| Message | Cause | Action |
|---|---|---|
| `Incorrect cluster: expected X but got Y`, `No current cluster` | The kubeconfig's current cluster is not the stack's `k8s-core` cluster, or it is broken (`pulumi/common/k8s/coreRef.ts`). | Switch context ([connect to the cluster](../sops/connect-to-k8s-cluster.md)) and rerun. |
| `Argo CD is not installed on the cluster that <ns> runs on` | The cluster has no `argoproj.io` API. Nothing was changed. | Escalate: Argo CD, the renderer plugin and the `tamanu` project must be installed first ([K8SNSP](../spec/kubernetes/namespaces.md#argo-cd-access)). |
| `<ns> was deployed by the previous program and is not marked for the move to Argo CD` | A deployment made by the previous Pulumi program is handed over in two steps and the first was not run. | See the handover below. |
| `Legacy objects were still present after 10 minutes` | The handover could not remove the previous program's objects in time. | Escalate. |
| `ttlHours must be a non-negative integer` | Bad `ttlHours` ([TSD](../spec/tamanu/scaledown.md#time-to-live)). | Fix the key. |
| `<key> is a secret, which cannot be passed to the renderer` | A secret was set in the stack config. | Remove it and set it as a plain value only if it is not a secret. Secrets do not go in stack config. |
| `rendererChannel "<x>" is not a renderer channel; use stable or canary` | Bad channel ([TRO](../spec/tamanu/renderer-rollout.md#channels)). | Fix the key. |
| `could not read the version of the image tagged <tag>`, `has no version label; set appVersion`, `appVersion ... is not a valid version` | The stub reads the Tamanu version from the image, and the tag is missing, unlabelled, or `appVersion` is invalid. | Fix the tag or set `appVersion` ([config reference](../reference/tamanu-deployment-config.md#identity-and-addresses)). |
| `Namespace name ... is reserved`, `Cannot have more facilityNames than facilities`, `Facility ... must be unique` | Config the stub validates itself. | Fix the key. |

## 4. Handover from the previous program

The error names the ops ref and the line to add: one update of the stack from the named ops ref marks the previous program's resources, then a normal update runs from the default ref (`pulumi/tamanu/on-k8s/src/argo/migrate.ts`). **[dev-OTS]**
Know what it does first:

- It replaces the Deployments, Gateways, routes and ConfigMaps that the previous program named itself, and keeps the databases, volumes and most Services.
- It briefly takes the servers down.
- The config ConfigMaps are copied across first, so hand edits are kept.
- The auth secrets are new, so every user is signed out.
- Each Gateway's Certificate is deleted with it, and the issued TLS Secret is kept, so the new Gateway's Certificate finds it. If a certificate is ordered anyway, it is a renewal for the same hostnames.

## 5. Escalate

Escalate for anything that is not a plain config or context mistake.
Give the stack, the exact message and the kubeconfig's cluster.
