---
id: LNXBAK
---

# Backups of Linux servers

The requirements in this spec apply to the backups of every [Linux server](../overview.md#linux-server): the [backup definitions](../overview.md#backup-definition) it carries, the restore setup of a [clone deployment](../overview.md#clone-deployment), the S3 bucket and roles that hold its backups, and the snapshots of its instances.

How bestool takes and restores a backup is specified by bestool's [BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md), and how [Canopy](../overview.md#canopy) schedules, retains and credentials backups is specified by Canopy's [BAK](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/backup.md).
How a PostgreSQL backup is captured and restored is specified by bestool's [BAK, the PostgreSQL method](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method), and how [pgro](../overview.md#pgro) restores and verifies it by pgro's [INT](https://github.com/beyondessential/postgres-restore-operator/blob/main/.workhorse/specs/canopy/intents.md).

## Borrowed terms

| term | meaning |
|---|---|
| Kopia repository | The content-addressed store, here in S3, that Kopia writes snapshots to ([Kopia repositories](https://kopia.io/docs/repositories/)). |
| storage class configuration | The `.storageconfig` object that tells Kopia which S3 storage class to use for which blobs ([Kopia storage tiers](https://kopia.io/docs/advanced/storage-tiers/)). |
| Object Lock | The S3 feature that prevents object versions from being deleted or overwritten for a retention period; governance mode lets a caller with a bypass permission shorten it ([S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)). |
| version, noncurrent version | A stored state of an S3 object, and a version that a later version or a delete marker has superseded ([S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)). |
| delete marker | The placeholder that S3 makes the current version of a versioned object when the object is deleted without naming a version ([S3 delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html)). |
| lifecycle rule | A bucket rule that expires or transitions objects by age ([S3 lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)). |
| incomplete multipart upload | An S3 multipart upload that has been neither completed nor aborted ([Deleting incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)). |
| trust policy | The policy of an IAM role that names the principals that may assume it ([IAM roles terms and concepts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html)). |
| chained `AssumeRole` | The assumption of a role by a principal that is itself a role session ([AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)). |
| AWS Backup | The AWS service that snapshots instances and volumes under backup plans, into backup vaults ([What is AWS Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)). |

## Backup definitions

A Linux server MUST carry a [backup definition](../overview.md#backup-definition) of each type in the following table that the table says it carries.
The format of a definition is specified by bestool's [BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#backup-definitions).

| type | content | carried by |
|---|---|---|
| `tamanu-postgres` | A PostgreSQL backup of the cluster named `main`, taken by the `postgresql` method of bestool. | every server that runs PostgreSQL |
| `postgres-config` | The PostgreSQL configuration files, tagged `area=postgres-config`. | every server that runs PostgreSQL |
| `tamanu-config` | The Tamanu configuration files. | every Tamanu server |
| `tamanu-secrets` | The server key, ordered after `tamanu-postgres`, with a post-restore hook that restarts the Tamanu services. | every Tamanu server that is not in a clone deployment |
| `caddy-config` | The reverse proxy configuration files, tagged `area=caddy-config`. | every server that runs Caddy |

The `tamanu-postgres` definition MUST be taken under the Canopy backup type `tamanu-postgres`.

> [!NOTE]
> pgro finds the snapshots it restores by filtering the repository on that type.

## Key pairing

Provisioning MUST take the first backup of type `tamanu-secrets` when the definition of that type is first installed on a server that already has the `tamanu-postgres` definition, and MUST warn where that backup fails.

> [!NOTE]
> A database backup is only restorable together with the server key that encrypts its secrets.

## Clone deployments

A [clone deployment](../overview.md#clone-deployment) MUST restore its servers from the backups of another deployment's servers.

The servers of a clone deployment MUST be members of an inventory whose variable `tamanu_clone` is true.

A clone deployment MUST write to the repository bucket of the deployment it clones, under its own source names.

A clone deployment MUST NOT carry a `tamanu-secrets` definition, and MUST remove one that exists.

> [!NOTE]
> A restored server key would let the clone decrypt the credentials of the source.

## Clone restore

The `tamanu-postgres` definition of a server in a clone deployment MUST contain the hooks in the following table.

| phase | order | action |
|---|---|---|
| pre-restore | 1 | Stop the Tamanu services. |
| post-restore | 1 | Remove from the database the identity it holds as the source server. |
| post-restore | 2 | Replace the server key with a new random one. |
| post-restore | 3 | Start the Tamanu services. |
| post-restore | 4 | Run the clone setup script of [LNXANS](ansible.md#clone-setup), where the server has one. |

The identity removal MUST be fatal where it fails.

The identity removal SHOULD call the database function that Tamanu provides for forgetting a server identity, where the function exists.

## Repository bucket

A deployment's backups MUST be written to one [repository bucket](../overview.md#repository-bucket) in the deployment's AWS account.

The name of a repository bucket MUST be the one that the following table gives for its infrastructure stack.

| stack | bucket name |
|---|---|
| a Tamanu deployment | `bes-tamanu-kopia-backups-<normalised stack name>` |
| a repository stack | the configured name, or `bes-kopia-backups-<stack name>` |

A repository bucket MUST have Object Lock enabled with a default retention of 30 days in governance mode.

A repository bucket MUST have versioning enabled.

A repository bucket MUST be protected against destruction by infrastructure code, except in the run that removes it from a retired deployment as [LNXAWS](aws.md#retired-deployments) requires.

A repository bucket MUST deny every request that is not sent over TLS.

A repository bucket MUST have a lifecycle rule that expires a noncurrent version 35 days after it becomes noncurrent, and one that aborts an incomplete multipart upload 7 days after it is initiated.

A repository bucket of a repository stack MUST also have a lifecycle rule that removes a delete marker once no noncurrent version of its object remains.

A repository bucket MUST contain the storage class configuration `.storageconfig`, which gives blobs under the prefix `p` the storage class `INTELLIGENT_TIERING` and every other object the storage class `STANDARD`.

A repository bucket MUST be tagged with `Purpose` set to `tamanu-backups` for a Tamanu deployment and `backups` for a repository stack, and a Tamanu deployment's bucket MUST also carry the tags `Stack` and `ManagedBy`.

The outputs of the stack MUST include the bucket name, the bucket ARN, the ARN of the device role and the ARN of the maintenance role.

A deployment that is a clone of another stack MUST NOT create a bucket, roles or users, and MUST export the outputs of the stack it clones.

> [!NOTE]
> With Object Lock and versioning, a delete that names no version leaves a delete marker over a locked version, and the lifecycle rules are the only route to permanent removal.

## Repository roles

A repository bucket MUST have a [device role](../overview.md#device-role) and a [maintenance role](../overview.md#maintenance-role).

The device role MUST be reachable only through the principals that its trust policy names.

The device role MUST grant the actions in the following table on the bucket and on every object in it, and no other action.

| action |
|---|
| `s3:ListBucket` |
| `s3:GetBucketLocation` |
| `s3:GetObject` |
| `s3:GetObjectAttributes` |
| `s3:GetObjectTorrent` |
| `s3:PutObject` |
| `s3:ListBucketMultipartUploads` |
| `s3:ListMultipartUploadParts` |
| `s3:AbortMultipartUpload` |
| `s3:DeleteObject` |
| `s3:GetBucketObjectLockConfiguration` |

The device role MUST NOT grant `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention` or `s3:PutObjectRetention`.

The trust policy of the device role MUST allow chained `AssumeRole` from the issuer, and from the private server, of [Canopy](../overview.md#canopy), and MUST allow no other principal.

The maintenance role MUST grant every S3 action on the bucket and every object in it, and `cloudwatch:GetMetricStatistics` and `cloudwatch:ListMetrics` on all resources.

The trust policy of the maintenance role MUST allow chained `AssumeRole` from the jobs workload, and from the private server, of Canopy.

The trust policy of the maintenance role MUST NOT allow the issuer of Canopy.

> [!NOTE]
> The issuer is reachable from the internet, so the delete and bypass permissions of the maintenance role stay out of its reach, and a compromised device can only write delete markers.

## Canopy registration

Where the stack configures a server group identifier, it MUST register the bucket, its region, the ARN of the device role and the ARN of the maintenance role as the backup configuration of that group in Canopy.

The registration MUST be replaced where the group identifier or the bucket changes, and updated in place where the region or a role ARN changes.

## Instance snapshots

A deployment MUST have an AWS Backup vault named `tamanu-on-linux-<stack>`, and a backup plan that has the rules in the following table.

| rule | schedule (UTC) | retention |
|---|---|---|
| `daily-keep7days` | every day at 00:30 | 7 days |
| `weekly-keep4weeks` | every Saturday at 12:00 | 28 days |
| `monthly-cold12months` | the first of every month at 00:00 | 365 days, moved to cold storage after 1 day |

The plan MUST select every instance and volume that the deployment provisions.

The plan MUST also select every EC2 instance and EBS volume in the account that carries the tag `TamanuExternalBackup` with the stack name as its value.

The backup service role MUST carry the AWS managed policies for backup and for restore.

An external server MUST NOT be covered by the plan.

## Backup failure notification

A failed, aborted or expired AWS Backup job in any account of the organisation MUST be forwarded to a central event bus.
