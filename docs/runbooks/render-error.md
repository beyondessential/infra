# Runbook: Application shows a render error

The Argo CD Application has a `ComparisonError` condition.
The render failed, so nothing is applied: the live deployment stays as it was.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

`status.conditions` on the Application contains a `ComparisonError`, or `pulumi up` logged `Application <name>: <message>` while waiting ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#parameters) calls this a render error).

## 2. Establish context

Which deployment, which renderer channel, what changed recently: [deployment context](../deployment-context.md). **[diagnose]**
The channel matters: `canary` rejects unknown keys and `stable` ignores them.

## 3. Investigate

1. **Read the message** in `status.conditions` ([inspect an Application](../sops/inspect-application.md)). **[diagnose]**
2. **Reproduce it** by running the renderer on the Application's parameters ([inspect the render](../sops/inspect-render.md)). It reports the same error. **[diagnose, sensitive-data]** for the render output, **[diagnose]** for the error alone.
3. **If the message is about the plugin**, check the repo server and its sidecar ([read logs](../sops/read-logs.md#the-renderer)). **[diagnose]**

## 4. Interpret

| Message | Diagnosis | Action |
|---|---|---|
| `app path does not exist` | The Application's source path is missing from its pinned revision. The stub sets both, so this is a stub fault. | Escalate: `pulumi/tamanu/on-k8s/src/argo/application.ts`. |
| `plugin ... not found`, or the plugin never responds | The renderer sidecar on the repo server is not running or is the wrong version. | Check the pod's containers and the sidecar log. Escalate: the plugin setup is `pulumi/tamanu/k8s-infra/argo/index.ts`. |
| `unknown config key(s): <keys>` | A key the `canary` renderer does not know, or a mistyped key. | Fix or remove the key ([config reference](../reference/tamanu-deployment-config.md)), or add support in `tamanu/on-k8s/renderer/src/params.rs`. |
| `unknown field` while `parsing parameters` | The stub sent a shape that this channel's renderer does not accept ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#parameters)). | Escalate: `pulumi/tamanu/on-k8s/src/argo/paramsDocument.ts`. |
| `Invalid architecture` or `Invalid capacity` | The value is not `arm64`/`amd64` or `spot`/`ondemand`. | Fix the key. |
| `Cannot have more facilityNames than facilities`, `Facility ids must be unique`, `Facility hosts must be unique`, `Facility entries must have an id` | `facilityNames` is inconsistent with `facilities`. | Fix the keys. |
| `seedSnapshot writes fake clinical data` | `seedSnapshot` is on with `nodeEnv` `production`. Refused on purpose. | Do not work around it: [seeded deployments](seeded-deployment.md). |
| `backupsEnabled needs a bucket` | No `barmanBucket` and the cluster publishes none ([K8SBAK](../spec/kubernetes/database-backups.md#deployment-parameters)). | Set `barmanBucket`, or escalate if the cluster should provide one. |
| `unparseable Kubernetes quantity` or `unknown unit` | `dbStorage` or `dbMemory` is not a valid quantity. | Fix the key. |
| `Redirect target for <host>` ... | A `redirects` value is not a URL, has no host, or has a path. | Fix the key. |
| `parsing parameters` followed by a quoted value and a parse error | A key's value does not parse (for example a non-number in `facilities`). | Find the key whose value is quoted, and fix it. |

## 5. Resolve

Change the key and update the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
The Application renders on the next refresh after the parameters change.
If the stub and the renderer disagree on shape, no config change fixes it: that is a code fix, escalate.

## 6. Escalate

Escalate when the message is not a config mistake: a stub, plugin or shape fault.
Give the deployment, channel, the full `ComparisonError` text, and whether `stable` or `canary` renders it.
Stub and renderer sources: `pulumi/tamanu/on-k8s/src/argo/` and `tamanu/on-k8s/renderer/src/`.
