# Ruled-out actions and sensitive-data handling

This is the hard pre-filter for the infra support pack. Check it before suggesting or running any action.
Every action in this pack carries a tag from [the action-classification ladder](README.md#the-action-classification-ladder) the README defines, which is the one the Tamanu pack uses.

The **sensitive-data** flag is separate from the class and marks any step that touches personal or credential data, read-only steps included.
The Tamanu pack's [ruled-out list](https://github.com/beyondessential/tamanu/blob/main/docs/ruled-out-actions.md) also applies on a Kubernetes deployment (for example mass `UPDATE` or `DELETE` of clinical tables from psql).
This file adds what the infrastructure makes possible.

## Disposable and long-lived deployments

Several rules below depend on whether the deployment can be thrown away.
A deployment is **disposable** only when its `auto-deploy` ConfigMap has a `control` of the form `pr=<number>`: Tamanu CD tears those down itself when the pull request closes or goes stale ([deployment-context](deployment-context.md#origin)).
Every other deployment is **long-lived**, including release rehearsals, demos and anything without that ConfigMap.
If you cannot tell, treat it as long-lived.

## Ruled-out actions (never suggest)

These destroy backups, volumes or secrets, or overwrite a live database, and cannot be reversed from the cluster.

- **Deleting backup data or weakening its protection.** Deleting object versions or delete markers in a backup bucket, changing a bucket's versioning, lifecycle, policy or retention, adding a version-delete action to the backup role, or running `scripts/empty-locked-bucket.fish` against a backup bucket.
  Versioning and a role that cannot delete versions are what stop a compromised pod from destroying every backup ([K8SBAK](spec/kubernetes/database-backups.md#backup-bucket), [K8SBAK](spec/kubernetes/database-backups.md#backup-role)).
- **Restoring over a live database.** `pg_restore` or a `psql` replay into a running deployment's database, bootstrapping a `Cluster` from a snapshot or backup over existing data, or `scripts/clone-tamanu-k8s-databases.fish ... --execute` into a namespace that holds data (it replaces every database in the target).
  A seed snapshot is used only when a cluster is first created, so changing `seedSnapshot` on a running deployment does not restore anything ([seeded deployments](runbooks/seeded-deployment.md)).
  A deployment whose clusters are already gone is not this case: [restore from backup](sops/restore-databases-from-backup.md) is dev-OTS.
- **Deleting or editing volumes and snapshots.** `kubectl delete` or `edit` of a PersistentVolumeClaim, PersistentVolume, VolumeSnapshot or VolumeSnapshotContent that belongs to a database `Cluster`, to a seed snapshot in `tamanu-seed`, or to a blob store claim (`<server>-blobs`).
  Hibernation is the supported way to stop a database and keep its volumes ([K8STSD](spec/kubernetes/tamanu/scaledown.md#hibernation)).
  Releasing a claim reclaims what its content occupied, so a deleted blob claim can take the shared directory with it ([K8SVOL](spec/kubernetes/volumes.md#reclaim)).
- **Deleting a database `Cluster` outside a teardown.** The instance volumes of a deployment without `backupsEnabled` are the only copy.
  `kubectl cnpg destroy` is a developer operation, see [recoverable but dev-OTS](#consequential-but-recoverable-dev-ots).
- **Changing config so that Argo CD prunes a database.** Lowering `facilities`, renaming or removing entries of `facilityNames`, or changing `namespace` on a long-lived deployment.
  The Application prunes whatever the render no longer produces, which includes the removed facility's `Cluster` ([K8STDR](spec/kubernetes/tamanu/deployment-rollout.md#application)).
- **Destroying a long-lived deployment or its namespace.** Deleting its SubnamespaceAnchor in `tamanu-super`, `kubectl delete namespace`, `pulumi destroy`, `pulumi stack rm --force`, `scripts/tamanuStacks.fish --destroy --yes`, or removing the Application's finalizer.
  Deleting the anchor deletes the namespace and every object in it ([K8SNSP](spec/kubernetes/namespaces.md#deployment-namespaces), [HNC](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/how-to.md#delete-a-subnamespace)).
  The same actions on a disposable deployment are [dev-OTS](#consequential-but-recoverable-dev-ots), see [destroy a deployment](sops/destroy-deployment.md).
  So is the destroy and update that [restore from backup](sops/restore-databases-from-backup.md) makes once a deployment's clusters are already gone.
- **Destroying a cluster** (a `pulumi destroy` of a `k8s-core` or `k8s-essentials` stack, or deleting the EKS cluster).
- **Creating, rotating, recreating or deleting secrets.** `tamanu-crypto`, `config-secrets-<server>`, `<server>-db-app`, `<server>-db-superuser`, `<server>-raw-db`, `<server>-reporting-db`, the Secrets copied from `tamanu-system`, and any API key or credential.
  Recreating `config-secrets-<server>` signs every user out, and `tamanu-crypto` holds the key file the servers use to decrypt secret values.
  Putting `tamanu-crypto` back to the values its databases were written under is dev-OTS: [settings decryption failed](runbooks/settings-decryption-failed.md).
  Do not put a secret in stack config either: the stub refuses it ([config reference](reference/tamanu-deployment-config.md#rules-that-apply-to-every-key)).
- **Rewriting clinical data with the repo's scripts.** `scripts/rename-tamanu-facility.fish` and the `rename-tamanu-facility*.sql` and `repoint-tamanu-facility-config.fish` helpers rewrite facility identifiers across the databases.
  They are reviewed developer data fixes, the same class as the Tamanu pack's ban on bulk `UPDATE` of clinical tables.
- **Forcing the seed top-up Job to run again by hand.** It adds generated records on every run, so it runs once per image on purpose ([K8STDR](spec/kubernetes/tamanu/deployment-rollout.md#seed-top-up)).

## Consequential but recoverable (dev-OTS)

These are not behind the gate, but none is a first-line support action.
Each needs a developer and the context for why.

- **Destroying a disposable deployment**, including the last-resort teardown steps: [destroy a deployment](sops/destroy-deployment.md), [teardown stuck](runbooks/teardown-stuck.md).
- **`pulumi up` on any stack**, with or without a config change: [change a deployment's config](sops/change-deployment-config.md).
  Run the update from fresh config, because a stale local config rolls the image tag back.
- **Anything that changes rendering for many deployments at once**: restarting the Argo CD repo server, [promoting a renderer channel](sops/promote-renderer-channel.md), changing `rendererChannel`.
- **A hard refresh of one Application**: [hard-refresh an Application](sops/hard-refresh-application.md).
  Never on a hibernated deployment, which would run its hook Jobs against a database with no pods ([K8STRO](spec/kubernetes/tamanu/renderer-rollout.md#promotion)).
- **Restarting a server**, scaling a Deployment by hand, or deleting a pod: [restart services](sops/restart-services.md).
  Argo CD ignores replica counts, so a hand scale-down stays until someone scales back or the next update.
- **Editing or deleting the config ConfigMaps** (`config-central`, `config-facility-N`, `provisioning`): [edit or reset config](sops/edit-or-reset-config.md).
- **Lowering `backupRetentionDays`**, which shortens the recovery window and lets the archiver delete older base backups and WAL ([K8SBAK](spec/kubernetes/database-backups.md#recovery-window)).
- **Changing `capacity`, `architecture`, `dbStorage` or `dbMemory`** on an existing deployment, which reschedules or restarts its database pods.
- **Restoring a deployment whose database clusters are gone**: [restore from backup](sops/restore-databases-from-backup.md), including the [crypto key](runbooks/settings-decryption-failed.md).
- **Dropping the `reporting` schema** to unblock a migrator: [a hook Job failed](runbooks/hook-job-failed.md).
- **`kubectl cnpg destroy`** on one instance of a database. The Tamanu pack classes it the same way ([connect-psql](https://github.com/beyondessential/tamanu/blob/main/docs/sops/connect-psql.md)).

Waking a hibernated deployment is the one mutating step pre-signed here: [wake a deployment](sops/wake-deployment.md) is **approved-mitigation** ([K8STSD](spec/kubernetes/tamanu/scaledown.md#waking) lets a person do it, and the Argo CD default role allows it, [K8SNSP](spec/kubernetes/namespaces.md#argo-cd-access)).

## Sensitive-data handling

Tag these with **sensitive-data** on top of their class.

- **Reading any Secret** (`kubectl get secret ... -o json` or `-o yaml`), including `<server>-db-app` (its `uri` key carries the database password) and `<server>-db-superuser`.
  Prefer a command that does not print the value, and never paste one into a ticket, chat, commit or PR.
- **A database session on a deployment**, such as `kubectl exec ... -- psql`.
  The cluster route has no redaction, unlike `bestool tamanu psql`, so everything on screen is patient or test data ([connect to the database](sops/connect-database.md)).
- **Server logs** (`central-api`, `facility-N-api`, `facility-N-sync`, `central-tasks`).
  Request paths and errors can carry patient identifiers, which is the Tamanu pack's rule for access logs.
  Job logs can too when a migration fails on a row.
- **The config ConfigMaps and the render.** `provisioning` carries the initial admin login, and `config-*` carry integration settings, so `kubectl get configmap -o yaml` and the output of `infra-argo-tamanu-renderer` are both sensitive ([inspect the render](sops/inspect-render.md)).
  The Application's `PARAMS` is not: the stub refuses secret values in it ([K8STRO](spec/kubernetes/tamanu/renderer-rollout.md#parameters)).
- **Account identifiers.** This repository is public.
  The `serviceAccount` and `barmanRoleArn` values contain an AWS account id, so redact them, and client names, when quoting config outside the team.

General rule: never paste secrets, tokens, raw patient data or full hostnames of client deployments into tickets, chat, commits or PRs.
Redact first.
