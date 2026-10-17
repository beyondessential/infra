# Runbook: Application stays OutOfSync after a successful sync

The sync succeeded and the Application is still OutOfSync, with no real change to apply.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

`kubectl -n argocd-system get app tamanu-<stack>` shows `OutOfSync` and `Healthy` after a sync that completed.

## 2. Establish context

Which deployment and which channel: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **Does the Application carry the server-side diff setting?** Look for the annotation `argocd.argoproj.io/compare-options: ServerSideDiff=true` on it. **[diagnose]**
2. **Which field differs**: the Argo CD UI diff view of the out-of-sync resource, or compare the live object with the render ([inspect the render](../sops/inspect-render.md)). **[diagnose, sensitive-data]**

## 4. Interpret

The API server and its webhooks fill in default fields that the render leaves unset, and a plain diff reports them as drift without end.
The stub creates every Application with the server-side diff annotation and the `ServerSideApply` sync option to account for that ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#application)).

| Evidence | Diagnosis | Action |
|---|---|---|
| The annotation is missing | An Application created outside the stub, or edited. | Add it back, or update the stack so the stub restores it **[dev-OTS]**. |
| The annotation is present and a field still differs | A field that something else sets and the Application does not ignore. | Name the field and escalate: ignored differences are in `pulumi/tamanu/on-k8s/src/argo/application.ts` ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#ignored-differences)). |

## 5. Resolve

Restore the annotation by updating the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.

## 6. Escalate

Escalate with the field name, the resource and the live and rendered values (redacted).
