---
id: LNXBAK
---

# Backups of Linux servers

The requirements in this spec apply to the backups of every [Linux server](../overview.md#linux-server): the [backup definitions](../overview.md#backup-definition) it carries, the restore of a [clone deployment](../overview.md#clone-deployment), the S3 bucket and roles that hold its backups, and the snapshots of its instances.
How a PostgreSQL backup is captured and restored is specified by [PPB](../postgres-physical-backup.md), and how backups are scheduled and retained is the responsibility of [Canopy](../overview.md#canopy).

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

A Linux server MUST carry the [backup definitions](../overview.md#backup-definition) in the following table, each as a file in `/etc/bestool/backups` that names its type.

| type | file | content | carried by |
|---|---|---|---|
| `tamanu-postgres` | `tamanu-postgres.toml` | a PostgreSQL backup of the cluster named `main` | every server that runs PostgreSQL |
| `postgres-config` | `postgres-config.toml` | the tag `area` with the value `postgres-config`, and a file backup of `/etc/postgresql` | every server that runs PostgreSQL |
| `tamanu-config` | `tamanu-config.toml` | a file backup of `/etc/tamanu` | every Tamanu server |
| `tamanu-secrets` | `tamanu-secrets.toml` | the server key, ordered after `tamanu-postgres`, with a post-restore hook that restarts the Tamanu services | every Tamanu server that is not in a clone deployment |
| `caddy-config` | `caddy-config.toml` | the tag `area` with the value `caddy-config`, and a file backup of `/etc/caddy` | every server that runs Caddy |

The directory `/etc/bestool/backups` and each definition in it MUST be owned by `root:root`, with mode 0755 for the directory and 0644 for a definition.

The [alert daemon](../overview.md#alert-daemon) MUST be reloaded when a definition changes.

The backup of a cluster MUST connect to PostgreSQL as the superuser `postgres` over the local socket, as [LNXDB](database.md#access) allows.

The `tamanu-postgres` definition MUST satisfy [PPB](../postgres-physical-backup.md).

## Key pairing

A restore of the database of a server MUST be refused until a backup of the server key exists to pair with it.

Provisioning MUST take the first backup of type `tamanu-secrets` when the definition of that type is first installed on a server that already has the `tamanu-postgres` definition, and MUST warn where that backup fails.

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
| post-restore | 1 | Run the identity scrub on the database `tamanu` as the user `postgres`, with errors fatal. |
| post-restore | 2 | Replace the podman secret `tamanu-config-key` with 32 new random bytes. |
| post-restore | 3 | Start the Tamanu services. |
| post-restore | 4 | Run `/etc/bestool/clone-setup.sh` where it exists. |

The identity scrub MUST call the database function `public.forget_server_identity()` within a transaction in which the setting `tamanu.this_is_a_copy` is `true`, where the function exists.

Where that function does not exist, the identity scrub MUST do the following.

1. Delete every row of `public.local_system_secrets` where the table exists.
1. Delete every row of `public.local_system_facts` whose key is `syncHost`, `syncEmail`, `facilityIds`, `deviceId` or `metaServerId`, or whose value matches `^S1:[^:]*:[^:]*$`.
1. Mark as deleted every undeleted row of `public.settings` whose value is a string that matches `^S1:[^:]*:[^:]*$`.

The setup script of a central server MUST run the database migrations of the installed Tamanu version, and then apply the SQL file of every facility sync account in `/etc/bestool/clone-sync` whose password file holds at least 64 characters, and MUST report failure where any step fails.

The setup script of a facility server MUST run the `setupSync` command of the facility image with `--force`, with the synchronisation URL formed from the scheme and host of `tamanu_central_canonical_url`, the user name `clone.<name>@sync.tamanu` and the password in `/etc/tamanu/clone-sync-password`, and with `TAMANU_FACILITY_IDS` set to the facility identifier.

The setup script MUST pass the password to its command in the environment and MUST NOT put it in a process argument.

## Clone sync accounts

A facility server of a clone deployment MUST have a synchronisation account on the central server, where the central server is in the same inventory and runs Tamanu 2.60.0 or later.

Where that does not hold, the sync accounts MUST be set up by hand and provisioning MUST warn that they are.

The name `<name>` of a facility's sync account MUST be the inventory host name in lower case with every character outside `a-z`, `0-9` and `-` replaced by `-`.

The password of a sync account MUST be 32 random bytes in hexadecimal, generated on the central server into `/etc/bestool/clone-sync/<name>.password` with mode 0400 owned by `postgres`, and MUST NOT be derived from the inventory or written on the control host.

The directory `/etc/bestool/clone-sync` MUST have mode 0700 and be owned by `postgres`.

The password MUST be generated once, and replaced only where its file is deleted.

The facility server MUST receive the password in `/etc/tamanu/clone-sync-password`, with mode 0400 owned by `root`.

The SQL file of a sync account MUST create or update, in the table `users`, the row whose email is `clone.<name>@sync.tamanu`, with the display name `System: <facility identifier> sync (clone)`, the role `admin`, the kind `sync`, a bcrypt hash of the password with cost 10, visible and not deleted.

The SQL file MUST change nothing where the password is shorter than 64 characters.

## Repository bucket

A deployment's backups MUST be written to one [repository bucket](../overview.md#repository-bucket) in the deployment's AWS account.

The name of a repository bucket MUST be the one that the following table gives for its infrastructure stack.

| stack | bucket name |
|---|---|
| a Tamanu deployment | `bes-tamanu-kopia-backups-<normalised stack name>` |
| a repository stack | the configured name, or `bes-kopia-backups-<stack name>` |

A repository bucket MUST have Object Lock enabled with a default retention of 30 days in governance mode.

A repository bucket MUST have versioning enabled.

A repository bucket MUST be protected against destruction by infrastructure code.

A repository bucket MUST deny every request that is not sent over TLS.

A repository bucket MUST have a lifecycle rule that expires a noncurrent version 35 days after it becomes noncurrent, and one that aborts an incomplete multipart upload 7 days after it is initiated.

A repository bucket of a repository stack MUST also have a lifecycle rule that removes a delete marker once no noncurrent version of its object remains.

A repository bucket MUST contain the storage class configuration `.storageconfig`, which gives blobs under the prefix `p` the storage class `INTELLIGENT_TIERING` and every other object the storage class `STANDARD`.

A repository bucket MUST be tagged with `Purpose` set to `tamanu-backups` for a Tamanu deployment and `backups` for a repository stack, and a Tamanu deployment's bucket MUST also carry the tags `Stack` and `ManagedBy`.

The outputs of the stack MUST include the bucket name, the bucket ARN, the ARN of the [device role](../overview.md#device-role), and the ARN of the [maintenance role](../overview.md#maintenance-role) where one exists.

A deployment that is a clone of another stack MUST NOT create a bucket, roles or users, and MUST export the outputs of the stack it clones.

> [!NOTE]
> With Object Lock and versioning, a delete that names no version leaves a delete marker over a locked version, and the lifecycle rules are the only route to permanent removal.

## Repository roles

A repository bucket MUST have a device role.

The device role MUST be reachable only through the principals that its trust policy names.

### With Canopy infrastructure

Where the stack names the Canopy infrastructure stack, the device role MUST grant the actions in the following table on the bucket and on every object in it.

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

Where the stack names the Canopy infrastructure stack, the device role MUST NOT grant `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention` or `s3:PutObjectRetention`.

Where the stack names the Canopy infrastructure stack, the trust policy of the device role MUST allow chained `AssumeRole` from the issuer, and from the private server, of [Canopy](../overview.md#canopy).

Where the stack names the Canopy infrastructure stack, the bucket MUST have a maintenance role.

The maintenance role MUST grant every S3 action on the bucket and every object in it, and `cloudwatch:GetMetricStatistics` and `cloudwatch:ListMetrics` on all resources.

The trust policy of the maintenance role MUST allow chained `AssumeRole` from the jobs workload, and from the private server, of Canopy.

The trust policy of the maintenance role MUST NOT allow the issuer of Canopy.

> [!NOTE]
> The issuer is reachable from the internet, so the delete and bypass permissions of the maintenance role stay out of its reach, and a compromised device can only write delete markers.

### Without Canopy infrastructure

Where the stack does not name the Canopy infrastructure stack, the trust policy of the device role MUST allow the EC2 service principal.

Where the stack does not name the Canopy infrastructure stack, the device role MUST grant the actions of the table in [With Canopy infrastructure](#with-canopy-infrastructure) except `s3:GetBucketObjectLockConfiguration`, together with `s3:PutObjectRetention`.

Where the stack does not name the Canopy infrastructure stack, there MUST be one IAM user for each server, holding the same grant as the device role.

Where the stack does not name the Canopy infrastructure stack, there MUST be one read-only IAM user holding `s3:GetObject`, `s3:GetObjectAttributes`, `s3:GetBucketLocation`, `s3:GetObjectTorrent` and `s3:ListBucket` on the bucket and every object in it.

## Canopy registration

Where the stack configures a server group identifier, it MUST register the bucket, its region, the ARN of the device role and the ARN of the maintenance role as the backup configuration of that group in Canopy.

Registration MUST require that the stack names the Canopy infrastructure stack.

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
