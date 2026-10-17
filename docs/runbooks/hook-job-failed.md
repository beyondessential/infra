# Runbook: a migrator or other hook Job failed

A Job in the namespace is `Failed`, and a sync stopped at wave 1 or 2.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

`kubectl -n tamanu-<stack> get jobs` shows a failed `<server>-migrator`, `<server>-reporting-grants`, `central-provisioner` or `facility-N-setup-sync`.
These are Argo CD hooks: they are deleted and created again on every sync, including a sync where the image did not change, so read the logs before anything triggers one ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)).

## 2. Establish context

Which Job, which server, the Tamanu version and what changed: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **The Job's logs**: `kubectl -n tamanu-<stack> logs job/central-migrator` ([read logs](../sops/read-logs.md#hook-jobs)). **[diagnose, sensitive-data]**
2. **The server's database**: is its `Cluster` healthy ([database not coming up](database-not-coming-up.md))? **[diagnose]**
3. **The Tamanu version** against the data: [deployment context](../deployment-context.md#reading-the-state). **[diagnose]**

## 4. Interpret

| Job | What it does | Failure usually means |
|---|---|---|
| `<server>-migrator` (wave 1, 5 retries) | Runs `migrate`. | The database could not be migrated: the cluster is unhealthy, or the image version does not match the data (for example an older image against a newer schema). |
| `<server>-reporting-grants` (wave 1) | Reconciles the `app` role's memberships and `CREATEROLE`, using `<server>-db-superuser` (`tamanu/on-k8s/renderer/src/postgres/reporting.rs`). | A database or permission problem. A pod that never starts means the Secret does not exist yet ([stuck progressing](application-stuck-progressing.md)). |
| `central-provisioner` (wave 2, 2 retries) | Runs `provision --skip-if-not-needed` on the `provisioning` ConfigMap. | A hand edit broke `provisioning`, or the migrator did not finish. |
| `facility-N-setup-sync` (wave 2, 5 retries) | Runs `setupSync` to seed the central address and credentials into the facility. | Needs the provisioning document and a reachable central. Only present for Tamanu 2.60.0 or later, and omitted when the version is unknown ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#version-gated-steps)). |

The stub runs these Jobs on every sync ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)), so a Job that fails only on a re-run against an unchanged image has a command that is not safe to repeat: that is a Tamanu fault.

## 5. Resolve

- Fix the cause: database health, image version, or the `provisioning` ConfigMap ([edit or reset config](../sops/edit-or-reset-config.md), **[dev-OTS, sensitive-data]**).
- The next sync recreates the Job. To trigger it, update the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
- A failed `facility-N-setup-sync` on a version that predates 2.60.0 cannot happen: the version is wrong or unknown, so check `appVersion`.

## 6. Escalate

Escalate when the migrator fails on the schema or data, or a Job is not repeat-safe: that needs a Tamanu change.
Give the Job log (redacted), the image tag and version, and the database state.
