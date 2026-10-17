---
id: K8SBAK
---

# Database backups on Kubernetes

The requirements in this spec apply to every CloudNativePG cluster that archives to object storage, and to the object storage and credentials it archives with.
Tuning, scheduling and the resource requests of the archiving sidecar are defined by [K8SPGC](postgres.md).

## Borrowed terms

| term | meaning |
|---|---|
| cluster | A CloudNativePG `Cluster` resource, a PostgreSQL primary with its replicas ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). Within this spec the word never means a Kubernetes cluster. |
| object store | A Barman Cloud plugin `ObjectStore` resource, which holds the destination, credentials method, compression and retention policy that a cluster archives under ([Barman Cloud plugin object stores](https://cloudnative-pg.io/plugin-barman-cloud/docs/object_stores/)). |
| scheduled backup | A CloudNativePG `ScheduledBackup` resource, which takes base backups on a cron schedule ([CloudNativePG backup](https://cloudnative-pg.io/documentation/current/backup/)). |
| WAL archiving | PostgreSQL's copying of each completed write-ahead log segment to storage outside the server ([PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)). |
| base backup | A file-level copy of the data directory of a cluster, from which WAL replay starts ([PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)). |
| recovery window | The period back from the present within which a cluster can be restored to any moment; the retention policy of an object store sets it ([Barman Cloud plugin retention policies](https://cloudnative-pg.io/plugin-barman-cloud/docs/retention/)). |
| version, noncurrent version | A stored state of an S3 object, and a version that a later version or a delete marker has superseded ([S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)). |
| delete marker | The placeholder that S3 makes the current version of a versioned object when the object is deleted without naming a version ([S3 delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html)). |
| lifecycle rule | A bucket rule that expires or transitions objects by age ([S3 lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)). |
| incomplete multipart upload | An S3 multipart upload that has been neither completed nor aborted ([Deleting incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)). |
| IAM role for a service account | An IAM role that the pods of a Kubernetes service account assume by web identity through the OIDC provider of the Kubernetes cluster ([IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)). |

## WAL archiving

A cluster with backups enabled MUST archive its WAL continuously to an object store.

The cluster MUST name the Barman Cloud plugin as its WAL archiver, naming its object store and a server name.

The server name MUST be the name of the cluster.

The object store of a cluster MUST be named `<cluster>-object-store` and MUST live in the namespace of the cluster.

An object store SHOULD serve one cluster only.

An object store SHOULD compress WAL and base backup data with gzip.

The archive of a cluster MUST be written to the [backup bucket](../overview.md#backup-bucket) at the location that [Object layout](#object-layout) gives.

## Base backups

A cluster that archives MUST have a scheduled backup named `<cluster>-scheduled` in the namespace of the cluster.

The scheduled backup MUST take base backups through the Barman Cloud plugin.

The scheduled backup MUST take a base backup every day.

The scheduled backup SHOULD use the schedule `0 0 2 * * *`, a six-field expression whose first field is seconds.

The scheduled backup SHOULD take a base backup when it is created, without waiting for the first scheduled time.

A backup resource that the scheduled backup creates SHOULD be owned by the scheduled backup.

## Recovery window

The object store of a cluster MUST declare a retention policy of `<days>d`, where `<days>` is the number of days in the recovery window of the cluster.

The archive of a cluster MUST hold the base backups and WAL needed to restore the cluster to any moment within its recovery window.

The recovery window of a database SHOULD default to the value that the following table gives for it.

| database | backups | default recovery window |
|---|---|---|
| Tamanu deployment, central and each facility | Enabled only where the deployment enables them. | 3 days |
| Canopy meta database | Always enabled. | 30 days |
| pollen database | Always enabled. | 30 days |

The recovery window of a database MUST be configurable for each deployment.

## Backup bucket

A Kubernetes cluster MUST provide one backup bucket for the databases that run on it.

The backup bucket of a Kubernetes cluster MUST be named `bes-k8s-<name>-backups`, where `<name>` is the name of the Kubernetes cluster.

The backup bucket of a Kubernetes cluster SHOULD carry the tag `Purpose=k8s-backups` and the tags of the Kubernetes cluster.

Versioning MUST be enabled on a backup bucket.

A noncurrent version in a backup bucket MUST be retained for at least 30 days after it becomes noncurrent.

A backup bucket SHOULD have a lifecycle rule that permanently deletes a noncurrent version 30 days after it becomes noncurrent.

A backup bucket SHOULD have a lifecycle rule that removes a delete marker once no noncurrent version of its object remains.

A backup bucket SHOULD have a lifecycle rule that aborts an incomplete multipart upload 7 days after it is initiated.

Objects in a backup bucket MUST be encrypted at rest.

> [!NOTE]
> The Barman Cloud plugin removes the objects that fall outside the recovery window itself, and it deletes without naming a version.
> Under versioning each such delete leaves a delete marker over a retained version, so a mistaken or hostile delete does not destroy a backup, and the lifecycle rules are the only route to permanent removal.
> A bucket without versioning, or a role that can delete versions, lets one compromised pod destroy every backup in the bucket.

## Backup role

A Kubernetes cluster MUST provide one [backup role](../overview.md#backup-role), which is an IAM role for a service account.

The backup role of a Kubernetes cluster MUST be assumable only through web identity from the OIDC provider of that Kubernetes cluster, for the audience `sts.amazonaws.com`.

The backup role of a Kubernetes cluster MUST be assumable from a service account of any name in any namespace of that Kubernetes cluster.

> [!NOTE]
> The operator creates the service account of a cluster in the namespace of the deployment that owns it, named for the cluster, so the trust cannot name one namespace or one account.

A backup role MUST be granted the actions in the following table on its backup bucket and on every object in it.

| action | use |
|---|---|
| `s3:ListBucket` | List the archive. |
| `s3:GetBucketLocation` | Resolve the region of the bucket. |
| `s3:GetObject` | Read an object. |
| `s3:GetObjectAttributes` | Read the attributes of an object. |
| `s3:GetObjectTorrent` | Read an object as a torrent. |
| `s3:PutObject` | Write an object. |
| `s3:ListBucketMultipartUploads` | List the multipart uploads in progress. |
| `s3:ListMultipartUploadParts` | List the parts of a multipart upload. |
| `s3:AbortMultipartUpload` | Abort a multipart upload. |
| `s3:DeleteObject` | Delete an object without naming a version. |

A backup role MUST NOT be granted any action outside the table.

> [!NOTE]
> The table omits every action that deletes a version, or that changes the versioning, lifecycle rules, policy or object retention of the bucket.
> Credentials taken from a pod therefore cannot remove anything permanently.

The backup role of a Kubernetes cluster MUST grant access to no bucket other than the backup bucket of that Kubernetes cluster.

An object store MUST obtain its credentials from the IAM role of the service account of the instance pod.

An object store MUST NOT hold static access keys.

The service account of a cluster SHOULD carry the annotation `eks.amazonaws.com/role-arn` naming the backup role, whether or not the cluster archives.

## Object layout

The archive of a cluster MUST be written under the destination path `s3://<bucket>/<deployment>/<cluster>/`, where `<bucket>` is the bucket that the cluster archives to, `<deployment>` is the name of the deployment that owns the cluster, and `<cluster>` is the name of the cluster.

Two clusters MUST NOT share a destination path.

The deployment name MUST be the value that the following table gives for the owner of the cluster.

| owner of the cluster | deployment name |
|---|---|
| Tamanu deployment | The stack name of the deployment in lower case, with each run of characters other than letters, digits and hyphens replaced by one hyphen, and cut to at most 56 characters with leading and trailing hyphens removed. |
| Canopy meta database | `tamanu-meta-` followed by the stack name. |
| pollen database | `pollen-` followed by the stack name. |

## Deployment parameters

A Tamanu deployment SHOULD give each of its clusters, central and each facility, the same backup settings.

The settings of a Tamanu deployment that govern backups are the following.

| parameter | meaning | default |
|---|---|---|
| `backupsEnabled` | Whether its clusters archive and take scheduled base backups. | `false` |
| `backupRetentionDays` | The number of days in the recovery window. | 3 |
| `barmanBucket` | The bucket its clusters archive to. | The backup bucket of the Kubernetes cluster. |
| `barmanRoleArn` | The role its instance pods assume. | The backup role of the Kubernetes cluster. |

A bucket that a Tamanu deployment names MUST be a backup bucket.

A role that a Tamanu deployment names MUST be a backup role.

Rendering a Tamanu deployment that enables backups MUST fail where no bucket is available from the deployment or from the Kubernetes cluster.

## Provisioning access

The identity that deploys a Tamanu deployment MUST be able to create, update and delete the clusters, object stores, scheduled backups and backup resources in the namespace of the deployment.
