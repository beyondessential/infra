# Runbook: a config or template change did not reach a deployment

A Tamanu config value or renderer template was changed, and an existing deployment keeps the old behaviour.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The renderer's templates or a stack key changed, and a deployment that already exists still has the old config.
Or a hand edit of `config-central`, `config-facility-N` or `provisioning` has vanished or never took effect.

## 2. Establish context

Which deployment, which key or template, whether it is a stack config key or file content: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **A stack key** shows in the Application's parameters ([deployment context](../deployment-context.md#reading-the-state)). If it is there, the renderer has it. **[diagnose]**
2. **File content** is in the ConfigMap ([edit or reset config](../sops/edit-or-reset-config.md#read)). **[diagnose, sensitive-data]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| A stack key is not in the parameters | The update has not run, or the key is in the stub-only set and never reaches the renderer ([config reference](../reference/tamanu-deployment-config.md#argo-cd-and-renderer-plumbing-stub-only)). | Update the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**. |
| The ConfigMap holds old content | The three config ConfigMaps are written once and Argo CD ignores their contents afterwards, so a template change reaches only new deployments ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#ignored-differences)). | Reset the ConfigMap ([edit or reset config](../sops/edit-or-reset-config.md#reset-to-the-rendered-default)) **[dev-OTS, sensitive-data]**. This drops hand edits. |
| The templates are the renderer's, not the cluster's | Templates are built into the renderer image (`tamanu/on-k8s/renderer/templates`). Editing the `tamanu-system` template ConfigMaps changes nothing for these deployments. | Change the renderer and promote it ([promote a renderer channel](../sops/promote-renderer-channel.md)). |
| A mistyped `configTemplate` | A name with no template falls back to `basic` without an error. | Fix the key. |
| The ConfigMap is right and behaviour is old | The server may not have re-read the file. This assumes the setting comes from the file at start: some Tamanu settings come from the database instead, so confirm in the Tamanu repository. | [Restart](../sops/restart-services.md) the affected servers **[dev-OTS]**. |

## 5. Resolve

Reset the ConfigMap or fix the key as above, then restart the affected servers.

## 6. Escalate

Escalate when the render itself produces the wrong content ([inspect the render](../sops/inspect-render.md)): that is a template fault in `tamanu/on-k8s/renderer/templates`.
