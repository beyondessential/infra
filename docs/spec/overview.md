---
id: OVR
---

# Overview

These specifications describe the infrastructure BES operates: its Kubernetes clusters, the Tamanu deployments on them, and the operators and tools that support them.

## Requirements notation

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL in these specifications are to be interpreted as described in BCP 14 ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals, as here.

## External documents

| document | what it covers |
|---|---|
| [RFC 8555](https://www.rfc-editor.org/rfc/rfc8555) | The ACME directory, account lookup by key and the DNS-01 challenge. Used by [K8SING](kubernetes/ingress.md) [CTLS](canopy/tls-issuance.md) and [LNXTLS](linux/tls.md). |
| [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000) and [RFC 9114](https://www.rfc-editor.org/rfc/rfc9114) | QUIC and HTTP/3. Used by [K8SING](kubernetes/ingress.md). |
| [PROXY protocol specification](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt) | The header that conveys a client address through a load balancer. Used by [K8SING](kubernetes/ingress.md). |
| [Gateway API](https://gateway-api.sigs.k8s.io/) | GatewayClass, Gateway, listeners and HTTPRoute. Used by [K8SING](kubernetes/ingress.md). |
| [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) | IngressClass. Used by [K8SING](kubernetes/ingress.md). |
| [cert-manager](https://cert-manager.io/docs/) | ClusterIssuer and certificate provisioning. Used by [K8SING](kubernetes/ingress.md). |
| [Envoy HTTP headers](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/headers) | The `x-forwarded-client-cert` header. Used by [K8SING](kubernetes/ingress.md). |
| [Network Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html) | The AWS NLB. Used by [K8SING](kubernetes/ingress.md). |
| [Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html) | Route 53 ALIAS records. Used by [K8SING](kubernetes/ingress.md). |
| [Amazon EC2 instance metadata service configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) | IMDSv2 and the metadata options of an instance. Used by [K8SNOD](kubernetes/nodes.md). |
| [Spot Instance interruptions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-interruptions.html) | The warning EC2 gives before reclaiming a Spot instance. Used by [K8SNOD](kubernetes/nodes.md). |
| [Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/) | The published interruption frequency of each instance type. Used by [K8SNOD](kubernetes/nodes.md). |
| [Service-linked role for Spot Instance requests](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/service-linked-roles-spot-instance-requests.html) | The `AWSServiceRoleForEC2Spot` role. Used by [K8SNOD](kubernetes/nodes.md). |
| [Karpenter disruption](https://karpenter.sh/docs/concepts/disruption/) | Consolidation and drift. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) | PodDisruptionBudgets. Used by [K8SNOD](kubernetes/nodes.md), [K8SPGC](kubernetes/postgres.md) and [K8STDR](kubernetes/tamanu/deployment-rollout.md). |
| [Kubernetes taints and tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) | Taints, tolerations and their effects. Used by [K8SNOD](kubernetes/nodes.md) and [K8STDR](kubernetes/tamanu/deployment-rollout.md). |
| [Kubernetes garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | The kubelet's image garbage collection thresholds. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) and [storage classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) | Claims, access modes and storage classes. Used by [K8SVOL](kubernetes/volumes.md) and [GRD](policies/guardrails.md). |
| [CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/) | The `Cluster` resource, instance pods, switchover and scheduled backups. Used by [K8SPGC](kubernetes/postgres.md), [PGS](pgsnap.md) and [K8SBAK](kubernetes/database-backups.md). |
| [PostgreSQL server configuration](https://www.postgresql.org/docs/current/runtime-config.html) | The server parameters that [K8SPGC](kubernetes/postgres.md) sets. |
| [pgtune](https://github.com/le0pard/pgtune) | The tuning algorithm that [K8SPGC](kubernetes/postgres.md) follows. |
| [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/) | Applications, projects, RBAC, config management plugins, the repo server, hard refresh, sync waves, hooks, health, automated sync, ignored differences and resource actions. Used by [K8STRO](kubernetes/tamanu/renderer-rollout.md), [K8STDR](kubernetes/tamanu/deployment-rollout.md), [K8STSD](kubernetes/tamanu/scaledown.md) and [K8SNSP](kubernetes/namespaces.md). |
| [Kubernetes volume snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) | VolumeSnapshot and VolumeSnapshotClass. Used by [PGS](pgsnap.md). |
| [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) and [owners and dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) | Suspended Jobs and owner references. Used by [PGS](pgsnap.md). |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | Version syntax and precedence. Used by [PGS](pgsnap.md). |
| [Prometheus exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) | The format of the metrics endpoint. Used by [PGS](pgsnap.md). |
| [PostgreSQL backup documentation](https://www.postgresql.org/docs/current/backup-file.html) | File system level backup and crash recovery. Used by [PPB](postgres-physical-backup.md). |
| [Kopia documentation](https://kopia.io/docs/) | The snapshot repository. Used by [PPB](postgres-physical-backup.md). |
| [Volume Shadow Copy Service](https://learn.microsoft.com/en-us/windows-server/storage/file-server/volume-shadow-copy-service) | Windows shadow copies. Used by [PPB](postgres-physical-backup.md). |
| [lvmthin](https://man7.org/linux/man-pages/man7/lvmthin.7.html) | LVM thin provisioning. Used by [PPB](postgres-physical-backup.md). |
| [RFC 5958](https://www.rfc-editor.org/rfc/rfc5958) | PKCS #8 private-key syntax. Used by [CTLS](canopy/tls-issuance.md). |
| [RFC 9499](https://www.rfc-editor.org/rfc/rfc9499) | DNS terminology: zone, apex, delegation. Used by [CTLS](canopy/tls-issuance.md). |
| [Working with public hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html) | Route 53 hosted zones. Used by [CTLS](canopy/tls-issuance.md). |
| [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) and [IAM roles terms and concepts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html) | Role assumption and trust policies. Used by [CTLS](canopy/tls-issuance.md). |
| [Condition keys for record sets](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-rrset-conditions.html) | Route 53 record-set condition keys. Used by [CTLS](canopy/tls-issuance.md) and [LNXTLS](linux/tls.md). |
| [Let's Encrypt staging environment](https://letsencrypt.org/docs/staging-environment/) | The untrusted-root staging authority. Used by [CTLS](canopy/tls-issuance.md). |
| [Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/) and [resource names](https://www.pulumi.com/docs/iac/concepts/resources/names/) | Policy packs, enforcement levels and URNs. Used by [GRD](policies/guardrails.md). |
| [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) | Deployment strategy and rollout. Used by [GRD](policies/guardrails.md), [K8STDR](kubernetes/tamanu/deployment-rollout.md) and [K8STSD](kubernetes/tamanu/scaledown.md). |
| [Amazon EFS access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html) and [EFS CSI driver parameters](https://github.com/kubernetes-sigs/aws-efs-csi-driver/blob/master/docs/parameters.md) | Access points and the storage class parameters of the EFS driver. Used by [GRD](policies/guardrails.md). |
| [GuardDuty and AWS Organizations](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_organizations.html) | The GuardDuty delegated administrator. Used by [GRD](policies/guardrails.md). |
| [Kubernetes node affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) and [topology spread constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/) | Pod placement. Used by [K8STDR](kubernetes/tamanu/deployment-rollout.md). |
| [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) | Liveness, readiness and startup probes. Used by [K8STDR](kubernetes/tamanu/deployment-rollout.md). |
| [Kubernetes CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) | Suspended CronJobs. Used by [K8STSD](kubernetes/tamanu/scaledown.md). |
| [CloudNativePG declarative hibernation](https://cloudnative-pg.io/documentation/current/declarative_hibernation/) | Hibernating a database cluster. Used by [K8STSD](kubernetes/tamanu/scaledown.md). |
| [py-kube-downscaler](https://github.com/caas-team/py-kube-downscaler) | The downscaler, forced downtime and exclusion. Used by [K8STSD](kubernetes/tamanu/scaledown.md). |
| [Barman Cloud plugin object stores](https://cloudnative-pg.io/plugin-barman-cloud/docs/object_stores/) and [retention](https://cloudnative-pg.io/plugin-barman-cloud/docs/retention/) | Object stores and the recovery window. Used by [K8SBAK](kubernetes/database-backups.md). |
| [PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html) | WAL archiving and base backups. Used by [K8SBAK](kubernetes/database-backups.md). |
| [Amazon S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html), [lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html) and [aborting incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html) | Versions, delete markers and lifecycle rules. Used by [K8SBAK](kubernetes/database-backups.md). |
| [IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html) | Pod access to AWS through a service account. Used by [K8SBAK](kubernetes/database-backups.md). |
| [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) | Roles, bindings and groups. Used by [K8SNSP](kubernetes/namespaces.md). |
| [Tailscale Kubernetes operator API server proxy](https://tailscale.com/kb/1437/kubernetes-operator-api-server-proxy), [grants](https://tailscale.com/kb/1324/grants) and [workload identity federation](https://tailscale.com/kb/1581/workload-identity-federation) | Authenticated access to the API server over the tailnet. Used by [K8SNSP](kubernetes/namespaces.md). |
| [Amazon EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html) | Mapping IAM principals to Kubernetes permissions. Used by [K8SNSP](kubernetes/namespaces.md). |
| [HNC concepts](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/concepts.md) and [how-to](https://github.com/kubernetes-sigs/hierarchical-namespaces/blob/master/docs/user-guide/how-to.md) | Namespace trees, subnamespace anchors and propagation. Used by [K8SNSP](kubernetes/namespaces.md). |
| [cloud-init](https://cloudinit.readthedocs.io/en/latest/) | First-boot user data. Used by [LNXSRV](linux/server.md). |
| [Work with instance tags in instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/work-with-tags-in-IMDS.html) | Instance tags through the metadata service. Used by [LNXSRV](linux/server.md). |
| [General purpose SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html) | The gp3 volume type. Used by [LNXSRV](linux/server.md). |
| [Tailscale tags](https://tailscale.com/kb/1068/tags), [SSH](https://tailscale.com/kb/1193/tailscale-ssh) and [HTTPS](https://tailscale.com/kb/1153/enabling-https) | Tailnet tags, Tailscale SSH and node certificates. Used by [LNXSRV](linux/server.md) and [LNXTLS](linux/tls.md). |
| [btrfs subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html) and [quota groups](https://btrfs.readthedocs.io/en/latest/Qgroups.html) | Subvolumes and qgroup limits. Used by [LNXSRV](linux/server.md) and [LNXDB](linux/database.md). |
| [systemd.slice](https://www.freedesktop.org/software/systemd/man/latest/systemd.slice.html), [systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html), [journald.conf](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html) and [systemd.socket](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html) | Slices, resource weights, the journal, template units and socket activation. Used by [LNXSRV](linux/server.md) and [LNXRUN](linux/runtime.md). |
| [chrony](https://chrony-project.org/documentation.html), [IP sysctl](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html), [UFW](https://help.ubuntu.com/community/UFW) and [Munin](https://munin-monitoring.org/) | Clock, TCP tuning, host firewall and metrics. Used by [LNXSRV](linux/server.md). |
| [What is AWS Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html) | Backup plans and vaults. Used by [LNXSRV](linux/server.md) and [LNXBAK](linux/backups.md). |
| [PostgreSQL clusters](https://www.postgresql.org/docs/current/creating-cluster.html), [pg_hba.conf](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html), [peer authentication](https://www.postgresql.org/docs/current/auth-peer.html), [user name maps](https://www.postgresql.org/docs/current/auth-username-maps.html), [password authentication](https://www.postgresql.org/docs/current/auth-password.html), [ALTER SYSTEM](https://www.postgresql.org/docs/current/sql-altersystem.html), [pg_upgrade](https://www.postgresql.org/docs/current/pgupgrade.html) and [pg_checksums](https://www.postgresql.org/docs/current/app-pgchecksums.html) | Cluster layout, authentication, parameters and upgrade. Used by [LNXDB](linux/database.md). |
| [podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html) and [podman-secret](https://docs.podman.io/en/latest/markdown/podman-secret.1.html) | Quadlets and secrets. Used by [LNXRUN](linux/runtime.md) and [LNXMSP](linux/msupply.md). |
| [Caddy documentation](https://caddyserver.com/docs/), [Caddyfile concepts](https://caddyserver.com/docs/caddyfile/concepts) and [the tls directive](https://caddyserver.com/docs/caddyfile/directives/tls) | The reverse proxy, snippets and certificate retrieval. Used by [LNXRUN](linux/runtime.md) and [LNXTLS](linux/tls.md). |
| [Kopia repositories](https://kopia.io/docs/repositories/), [storage tiers](https://kopia.io/docs/advanced/storage-tiers/) and [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) | The repository, its storage configuration and lock modes. Used by [LNXBAK](linux/backups.md). |
| [Canopy DOM](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#managed-zones) and [Canopy CRT](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md) | How Canopy reads its managed zones, and how it issues and renews certificates. Used by [CTLS](canopy/tls-issuance.md). |
| [bestool TLS](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/certificates.md) | How bestool obtains certificates from Canopy, serves them to Caddy, and grades them. Used by [LNXTLS](linux/tls.md). |
| [bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md) and [Canopy BAK](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/backup.md) | How bestool takes and restores backups, and how Canopy schedules, retains and credentials them. Used by [LNXBAK](linux/backups.md). |
| [Caddy global options](https://caddyserver.com/docs/caddyfile/options#cert-issuer) and [Caddy certificates on Tailscale](https://tailscale.com/kb/1190/caddy-certificates) | The certificate issuer option and Tailscale-issued certificates. Used by [LNXTLS](linux/tls.md). |
| [AWS shared config and credentials files](https://docs.aws.amazon.com/sdkref/latest/guide/file-format.html), [IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html) and [managed and inline policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html) | Credential files, users and policies. Used by [LNXTLS](linux/tls.md). |
| [Ansible playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html), [tags](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_tags.html), [check mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html), [inventory plugins](https://docs.ansible.com/ansible/latest/plugins/inventory.html) and [basic concepts](https://docs.ansible.com/ansible/latest/network/getting_started/basic_concepts.html) | Playbooks, plays, tags, check mode, inventory sources and the control node. Used by [LNXANS](linux/ansible.md). |
| [Tailscale Services](https://tailscale.com/kb/1552/tailscale-services) and [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) | Named services on the tailnet. Used by [LNXMSP](linux/msupply.md). |
| [Canopy INV](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/inventory.md) | What an inventory contains, reaching a machine and run leases. Used by [LNXANS](linux/ansible.md). |
| [bestool workload and healthchecks](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/substrate.md), [bestool logs](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/logs.md) and [bestool healthchecks](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/healthchecks.md) | How bestool supervises the Tamanu workload, finds logs and grades health. Used by [LNXRUN](linux/runtime.md) and [LNXANS](linux/ansible.md). |
| [Tamanu configuration sources](https://github.com/beyondessential/tamanu/blob/main/specs/administration/settings/overview.md#configuration-sources) and [secret encryption](https://github.com/beyondessential/tamanu/blob/main/specs/administration/settings/secret-encryption.md#storage) | Where Tamanu reads its configuration and how it stores secrets. Used by [LNXRUN](linux/runtime.md). |

## Terminology

### Canopy

The BES control plane for backups, which tracks whether a backup was taken, persisted and restored.
Defined by this gloss alone.

### pgro

The operator that restores and verifies `tamanu-postgres` backups.
Defined by this gloss alone.

### Tamanu CD

The system that creates Tamanu deployments and chooses the channel each one asks for.
Defined by this gloss alone.

### Deployer

The identity, in the access group `tailscale:tamanu-deploy`, that creates and changes the objects of a Tamanu deployment.
Defined in [K8SNSP](kubernetes/namespaces.md#deployer-limits).

### Canopy DNS identity

The identity in Canopy's own account under which the Canopy workload that writes DNS records runs.
Defined in [CTLS](canopy/tls-issuance.md#zone-access).

### Stub

The per-deployment program that creates what the renderer cannot render, and the Application that applies the render.
Defined in [K8STDR](kubernetes/tamanu/deployment-rollout.md#application).

### Central server

The Tamanu server that facility servers synchronise against.
Defined by this gloss alone.

### Facility server

A Tamanu server run at a clinic site that synchronises with the central server.
Defined by this gloss alone.

### bestool

The BES operator tool installed on Linux servers, which controls Tamanu services and runs the alert daemon.
Defined by this gloss alone.

### Alert daemon

The bestool service that runs health checks and backups and serves Canopy certificates to the proxy.
Defined by this gloss alone.

### Linux server

A host, managed by the Ansible playbooks, that runs a Tamanu central or facility server with its database and reverse proxy.
Defined in [LNXSRV](linux/server.md#server-types).

### External server

A Linux server that runs outside the deployment's AWS account and has only DNS records and certificate credentials provisioned for it.
Defined in [LNXSRV](linux/server.md#provisioning).

### Node pool

A set of nodes provisioned from one shared configuration, whether by a managed nodegroup or by a Karpenter NodePool.
Defined in [K8SNOD](kubernetes/nodes.md#node-identity).

### Dedicated pool

A node pool that only workloads which explicitly opt in can use.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### General workload pool

A node pool with purpose `workload` that is not a dedicated pool.
Defined in [K8SNOD](kubernetes/nodes.md#workload-capacity).

### Database replica pool

The dedicated pool that hosts restored database replicas.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### Critical database pool

The dedicated pool that hosts the databases production depends on.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### Exit node

A Tailscale node that forwards the internet traffic of connected clients, run as a workload in the cluster.
Defined in [K8SNOD](kubernetes/nodes.md#exit-node).

### Shared filesystem

A filesystem whose volumes several nodes mount read-write at once.
Defined in [K8SVOL](kubernetes/volumes.md#multi-node-access).

### Tuning basis

The memory request declared for the instance pods of a PostgreSQL cluster, from which its memory parameters are derived.
Defined in [K8SPGC](kubernetes/postgres.md#tuning-basis).

### tamanu-meta

The Tamanu workload whose clients authenticate by presenting a self-signed TLS client certificate.
Defined in [K8SING](kubernetes/ingress.md#client-certificates).

### Renderer

The image Argo CD runs as a plugin to turn the parameters of a Tamanu deployment into its Kubernetes objects.
Defined in [K8STRO](kubernetes/tamanu/renderer-rollout.md#channels).

### Channel

A named stream of renderer builds, `canary` or `stable`, that a Tamanu deployment is rendered by.
Defined in [K8STRO](kubernetes/tamanu/renderer-rollout.md#channels).

### Promotion

The act of moving a channel tag to a renderer build, with the steps that make deployments on that channel render with it.
Defined in [K8STRO](kubernetes/tamanu/renderer-rollout.md#promotion).

### Ephemeral cluster

A single-instance CloudNativePG cluster that pgsnap creates for one Job and deletes afterwards.
Defined in [PGS](pgsnap.md#snapshot-creation).

### Passthrough annotation

An annotation of a Job that pgsnap copies to the VolumeSnapshot it produces.
Defined in [PGS](pgsnap.md#passthrough-annotations).

### Snapshot strategy

Backing up a PostgreSQL cluster from an atomic snapshot of every volume it occupies.
Defined in [PPB](postgres-physical-backup.md#snapshot-strategy).

### Base backup strategy

Backing up a PostgreSQL cluster with `pg_basebackup` into a staging directory.
Defined in [PPB](postgres-physical-backup.md#base-backup-strategy).

### Core

The foundational infrastructure of one AWS account, which owns the account's public DNS zone.
Defined in [CTLS](canopy/tls-issuance.md#managed-zones).

### Zone role

The role a core creates for Canopy to assume in order to write records in that core's zone.
Defined in [CTLS](canopy/tls-issuance.md#zone-access).

### Backup bucket

The S3 bucket that holds the archives of PostgreSQL databases.
Defined in [K8SBAK](kubernetes/database-backups.md#backup-bucket).

### Backup role

The IAM role through which the instance pods of PostgreSQL databases reach a backup bucket.
Defined in [K8SBAK](kubernetes/database-backups.md#backup-role).

### Super namespace

The root namespace of a hierarchy, from which role bindings propagate to every descendant.
Defined in [K8SNSP](kubernetes/namespaces.md#namespace-tree).

### Deployment namespace

A namespace that holds one Tamanu deployment and is a child of the super namespace.
Defined in [K8SNSP](kubernetes/namespaces.md#deployment-namespaces).

### Access group

A Kubernetes group, named with the prefix `tailscale:`, that the tailnet policy assigns to a caller of the API server proxy.
Defined in [K8SNSP](kubernetes/namespaces.md#access-groups).

### Tamanu deployment

The central server, facility servers and patient portal of one namespace, with their databases, applied by one Argo CD Application.
Defined in [K8STDR](kubernetes/tamanu/deployment-rollout.md#application).

### Time to live

The number of hours a deployment stays up after its latest update before it is hibernated.
Defined in [K8STSD](kubernetes/tamanu/scaledown.md#time-to-live).

### Hibernation

Scaling a deployment's Deployments to zero and hibernating its database clusters, with their volumes kept.
Defined in [K8STSD](kubernetes/tamanu/scaledown.md#hibernation).

### Wake

Reversing the hibernation of a deployment.
Defined in [K8STSD](kubernetes/tamanu/scaledown.md#waking).

### Split layout

The storage layout in which `/var/log` and `/var/lib/postgresql` are separate volumes.
Defined in [LNXSRV](linux/server.md#storage-layout).

### Instance tags

The EC2 tags that provisioning writes and the playbooks read.
Defined in [LNXSRV](linux/server.md#instance-tags).

### Resource class

One of the three slices, critical, elevated and background, that divide CPU and I/O among a server's services.
Defined in [LNXSRV](linux/server.md#resource-classes).

### Credential seed

The secret value from which, with the machine identifier, a server's database passwords derive.
Defined in [LNXDB](linux/database.md#roles-and-credentials).

### Production server

A Linux server that provisioning treats as live, identified by its Tailscale name.
Defined in [LNXDB](linux/database.md#tuning).

### Server key

The per-server secret that encrypts the values Tamanu stores as secrets.
Defined in [LNXRUN](linux/runtime.md#server-key).

### Backup definition

A file that names one backup type for the alert daemon to run.
Defined in [LNXBAK](linux/backups.md#backup-definitions).

### Clone deployment

A deployment whose servers are restored from another deployment's backups.
Defined in [LNXBAK](linux/backups.md#clone-deployments).

### Repository bucket

The S3 bucket that holds the Kopia repository of a deployment's Linux servers.
Defined in [LNXBAK](linux/backups.md#repository-bucket).

### Device role

The IAM role whose credentials a server's backups use to write to the repository bucket.
Defined in [LNXBAK](linux/backups.md#repository-roles).

### Maintenance role

The IAM role that maintains and inspects a repository bucket.
Defined in [LNXBAK](linux/backups.md#repository-roles).
