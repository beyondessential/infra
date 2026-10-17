# Runbook: a renderer change does not show up

A renderer change was promoted but an Application still serves the old render.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The change was merged and promoted to the deployment's channel, and a deployment on that channel still looks as it did.
A change on `canary` does not reach `stable` deployments, and the reverse, because each channel has its own plugin ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#plugins)).

## 2. Establish context

The deployment's channel and whether it is hibernated: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **Channel** of the Application (label `bes.tamanu/renderer-channel`). **[diagnose]**
2. **Hibernation.** A promotion skips hibernated deployments on purpose ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#promotion)). **[diagnose]**
3. **The promotion run.** It fails when a cluster was not reached and names it. Look at the `infra-argo-tamanu-renderer promote` run in GitHub Actions. **[diagnose]**

## 4. Interpret

Argo CD caches a render by the source revision and the parameters.
The Application's revision is pinned, so a new renderer image gives the same cache key and the old render is kept until a hard refresh.
A promotion clears it for every Application on the channel.

| Evidence | Diagnosis | Action |
|---|---|---|
| Hibernated | Skipped by the promotion. | [Wake it](../sops/wake-deployment.md), which refreshes it. |
| Promotion failed naming a cluster | The tag moved but that cluster was not refreshed. | Repeat for that cluster: [promote a renderer channel](../sops/promote-renderer-channel.md) **[dev-OTS]**. |
| Promotion succeeded, one Application still old | The repo server may still serve the old plugin, or the refresh landed first. | [Hard-refresh the Application](../sops/hard-refresh-application.md), restarting the repo server first if needed **[dev-OTS]**. |
| Wrong channel | The deployment is on the other channel. | Expected: change the channel only on purpose ([config](../reference/tamanu-deployment-config.md#argo-cd-and-renderer-plumbing-stub-only)). |

## 5. Resolve

[Hard-refresh an Application](../sops/hard-refresh-application.md) for one, or `tamanu/on-k8s/renderer/tools/refresh-channel.sh <stable|canary>` for a whole channel on a cluster **[dev-OTS]**.

## 6. Escalate

Escalate when a refresh renders but the output is still wrong: that is a renderer fault, in `tamanu/on-k8s/renderer/src/`.
