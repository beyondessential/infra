# SOP: Restore a deployment's databases from backup

Bring back every database of a deployment whose `Cluster`s are gone, from its Barman Cloud archive.
**[dev-OTS] throughout**: a developer runs it, because it destroys and redeploys the deployment.
It applies only when the clusters and their volumes no longer exist; with any database still present, restoring over it is [ruled out](../ruled-out-actions.md#ruled-out-actions-never-suggest).
It needs `backupsEnabled` on the deployment ([K8SBAK](../spec/kubernetes/database-backups.md#deployment-parameters)), the cluster in `kubectl`, and `WriteAccess` to the account that holds the backup bucket.

## 1. Check the archive

Each cluster archives to `s3://bes-k8s-<cluster>-backups/<stack>/<server>-db/<server>-db/` ([K8SBAK](../spec/kubernetes/database-backups.md#object-layout)). **[diagnose]**

```sh
aws s3 ls --recursive s3://bes-k8s-<cluster>-backups/<stack>/central-db/central-db/ | grep -v /wals/ | tail
aws s3 ls --recursive s3://bes-k8s-<cluster>-backups/<stack>/central-db/central-db/ | grep /wals/ | tail -3
```

Every database needs a base backup within the [recovery window](../spec/kubernetes/database-backups.md#recovery-window), and its newest WAL is where recovery ends.
WAL is shipped every five minutes at most, so a cluster can lose up to five minutes, and two clusters of one deployment can end at different points: compare their newest WAL.

## 2. Move the archive aside

The redeployed clusters archive to the same paths, and Barman refuses to archive into a non-empty one.
Move each archive before the redeploy, and recover from the moved copy:

```sh
aws s3 mv --recursive s3://bes-k8s-<cluster>-backups/<stack>/ s3://bes-k8s-<cluster>-backups/incident-<date>/<stack>/
```

A move leaves delete markers over versions the bucket keeps, so no version is destroyed ([K8SBAK](../spec/kubernetes/database-backups.md#backup-bucket)).
Wait for it to finish before step 3.

## 3. Redeploy

From `pulumi/tamanu/on-k8s`, with the stack selected, at the image tag the deployment last ran (`pulumi stack history` shows it):

```sh
pulumi destroy
pulumi up --policy-pack ../../policies
```

Keep the stack: `pulumi stack rm` would discard its config.
If the destroy hangs on the namespace, see [teardown stuck](../runbooks/teardown-stuck.md).

The destroy and the update generate a new crypto key, which cannot decrypt the restored setting secrets.
Put the old one back now, from the last update before the destroy: [settings decryption failed](../runbooks/settings-decryption-failed.md#5-resolve).

## 4. Recover into a scratch namespace

Create `tamanu-<stack>-restore` and, in it, one `ObjectStore` and one `Cluster` per server with the same names as the deployment's (`central-db`, `facility-N-db`).
The clusters recover to the end of the moved archive and do not archive themselves.
Take the backup role ARN from any `Cluster` on the same Kubernetes cluster (`.spec.serviceAccountTemplate`), since the role is per cluster ([K8SBAK](../spec/kubernetes/database-backups.md#backup-role)).

```yaml
apiVersion: barmancloud.cnpg.io/v1
kind: ObjectStore
metadata: { name: origin-central-db, namespace: tamanu-<stack>-restore }
spec:
  configuration:
    destinationPath: s3://bes-k8s-<cluster>-backups/incident-<date>/<stack>/central-db/
    s3Credentials: { inheritFromIAMRole: true }
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: central-db, namespace: tamanu-<stack>-restore }
spec:
  instances: 1
  imageCatalogRef: { apiGroup: postgresql.cnpg.io, kind: ClusterImageCatalog, name: postgresql, major: <major> }
  enableSuperuserAccess: true
  storage: { size: <dbStorage> }
  affinity:
    nodeSelector: { bes.node.arch: arm64, bes.node.purpose: workload }
  serviceAccountTemplate:
    metadata: { annotations: { eks.amazonaws.com/role-arn: <backup role ARN> } }
  bootstrap:
    recovery: { source: origin, database: app, owner: app }
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters: { barmanObjectName: origin-central-db, serverName: central-db }
```

`<major>` is the redeployed clusters' `imageCatalogRef.major`.
Wait for `kubectl -n tamanu-<stack>-restore get clusters` to report every cluster healthy, then check the data is the deployment's ([connect to the database](connect-database.md)). **[diagnose, sensitive-data]**

## 5. Copy into the deployment

```sh
scripts/clone-tamanu-k8s-databases.fish <context> tamanu-<stack>-restore tamanu-<stack>             # dry run
scripts/clone-tamanu-k8s-databases.fish <context> tamanu-<stack>-restore tamanu-<stack> --execute
```

The script stops Argo CD's automated sync and its hook Jobs, scales the servers down, drops and recreates each database before restoring it, and stops at the first one that does not match its source.
At the end it scales the servers back and restores automated sync, which runs the migrators.
Its advice to rename facilities does not apply: source and target are the same deployment.

## 6. Interpret

| Evidence | Meaning | Action |
|---|---|---|
| A server logs `Database has been used with vX, but this server is vY` | A migrator of a newer image ran against the database before it was lost, and recovery replayed it. | Set `imageTag` to vX and update ([change a deployment's config](change-deployment-config.md)). |
| A migrator fails with `rule _RETURN on view reporting.<view> depends on column` | [A hook Job failed](../runbooks/hook-job-failed.md). | Drop the `reporting` schema as that runbook says. |
| `Decryption failed` in a server log | The crypto key was not put back. | [Settings decryption failed](../runbooks/settings-decryption-failed.md). |
| The clone script stops on a mismatch | The deployment is left scaled down with automated sync off. | Read the `pg_restore` lines it printed; escalate. |

## 7. Clean up

Delete `tamanu-<stack>-restore` once the deployment is healthy.
Keep the moved archive until the redeployed clusters have taken their first base backup.
