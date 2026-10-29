# Runbook: a migrator or other hook Job failed

A Job in the namespace is `Failed`, and a sync stopped at wave 1, 2 or 3.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

`kubectl -n tamanu-<stack> get jobs` shows a failed `<server>-quiesce`, `<server>-migrator`, `<server>-reporting-grants`, `central-provisioner`, `facility-N-setup-sync` or `<server>-resume`.
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
| `<server>-quiesce` (wave 1, 2 retries) | Runs `just-migrate list --check` in the server's image, which logs the pending migrations and exits 3 when there are any. If so, records each server Deployment's replicas in `tamanu.bes.au/replicas-before-migration`, scales them to zero and waits for their pods to go ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#quiescing-for-migrations)). Tamanu 2.67.0 or later. | Any exit but 0 or 3 from the check fails the Job: the database is unreachable, or the image predates the command. A timeout waiting for pods names the pods that did not stop. |
| `<server>-migrator` (wave 2, 5 retries) | Runs `migrate`. | The database could not be migrated: the cluster is unhealthy, or the image version does not match the data (for example an older image against a newer schema). |
| `<server>-reporting-grants` (wave 2) | Reconciles the `app` role's memberships and `CREATEROLE`, using `<server>-db-superuser` (`tamanu/on-k8s/renderer/src/postgres/reporting.rs`). | A database or permission problem. A pod that never starts means the Secret does not exist yet ([stuck progressing](application-stuck-progressing.md)). |
| `central-provisioner` (wave 3, 2 retries) | Runs `provision --skip-if-not-needed` on the `provisioning` ConfigMap. | A hand edit broke `provisioning`, or the migrator did not finish. |
| `facility-N-setup-sync` (wave 3, 5 retries) | Runs `setupSync` to seed the central address and credentials into the facility. | Needs the provisioning document and a reachable central. Only present for Tamanu 2.60.0 or later, and omitted when the version is unknown ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#version-gated-steps)). |
| `<server>-resume` (wave 3, 2 retries) | Scales each server Deployment carrying `tamanu.bes.au/replicas-before-migration` back to the recorded count and removes the annotation. Tamanu 2.67.0 or later. | An annotation that is not a whole number, or an API error. |

A `<server>-migrator` log of `cannot alter type of a column used by a view or rule`, naming `rule _RETURN on view reporting.<view>`, means a migration changes a column that a view in the `reporting` schema reads.
Those views are built outside Tamanu's migrations, and the migrator Job does not drop them.

After a failed `<server>-migrator`, that server's Deployments other than `<server>-web` sit at zero replicas carrying `tamanu.bes.au/replicas-before-migration`. That is intended: the servers stay stopped against a partly migrated database until a sync migrates successfully and `<server>-resume` brings them back.

The stub runs these Jobs on every sync ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)), so a Job that fails only on a re-run against an unchanged image has a command that is not safe to repeat: that is a Tamanu fault.

## 5. Resolve

- Fix the cause: database health, image version, or the `provisioning` ConfigMap ([edit or reset config](../sops/edit-or-reset-config.md), **[dev-OTS, sensitive-data]**).
- The next sync recreates the Job. To trigger it, update the stack ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
- A migrator blocked by a `reporting` view: save the schema, then drop it, on that server's database ([connect to the database](../sops/connect-database.md)) **[dev-OTS, sensitive-data]**.
  The migrator's retry then goes through; the views come back with the next reporting deploy, and the saved schema is there if they are needed before.

  ```sh
  pg_dump -U postgres -d app -s -n reporting > reporting-<stack>-<server>.sql
  psql -U postgres -d app -c 'DROP SCHEMA reporting CASCADE;'
  ```
- Servers left at zero after a failed migrator come back on their own once a later sync migrates: do not scale them up by hand against a partly migrated database. **[dev-OTS]** if a developer decides to, using the count in the annotation.
- A failed `facility-N-setup-sync` on a version that predates 2.60.0 cannot happen: the version is wrong or unknown, so check `appVersion`.

## 6. Escalate

Escalate when the migrator fails on the schema or data, or a Job is not repeat-safe: that needs a Tamanu change.
Give the Job log (redacted), the image tag and version, and the database state.
