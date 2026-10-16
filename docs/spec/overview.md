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
| [RFC 8555](https://www.rfc-editor.org/rfc/rfc8555) | The DNS-01 challenge of ACME. Used by [K8SING](kubernetes/ingress.md). |
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
| [Kubernetes disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) | PodDisruptionBudgets. Used by [K8SNOD](kubernetes/nodes.md) and [K8SPGC](kubernetes/postgres.md). |
| [Kubernetes taints and tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) | Taints, tolerations and their effects. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | The kubelet's image garbage collection thresholds. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) and [storage classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) | Claims and storage classes. Used by [K8SVOL](kubernetes/volumes.md). |
| [CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/) | The `Cluster` resource, instance pods and switchover. Used by [K8SPGC](kubernetes/postgres.md) and [PGS](pgsnap.md). |
| [PostgreSQL server configuration](https://www.postgresql.org/docs/current/runtime-config.html) | The server parameters that [K8SPGC](kubernetes/postgres.md) sets. |
| [pgtune](https://github.com/le0pard/pgtune) | The tuning algorithm that [K8SPGC](kubernetes/postgres.md) follows. |
| [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/) | Applications, config management plugins, the repo server and hard refresh. Used by [TRO](tamanu/renderer-rollout.md). |
| [Kubernetes volume snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) | VolumeSnapshot and VolumeSnapshotClass. Used by [PGS](pgsnap.md). |
| [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) and [owners and dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) | Suspended Jobs and owner references. Used by [PGS](pgsnap.md). |
| [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) | Version syntax and precedence. Used by [PGS](pgsnap.md). |
| [Prometheus exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/) | The format of the metrics endpoint. Used by [PGS](pgsnap.md). |
| [PostgreSQL backup documentation](https://www.postgresql.org/docs/current/backup-file.html) | File system level backup and crash recovery. Used by [PPB](postgres-physical-backup.md). |
| [Kopia documentation](https://kopia.io/docs/) | The snapshot repository. Used by [PPB](postgres-physical-backup.md). |
| [Volume Shadow Copy Service](https://learn.microsoft.com/en-us/windows-server/storage/file-server/volume-shadow-copy-service) | Windows shadow copies. Used by [PPB](postgres-physical-backup.md). |
| [lvmthin](https://man7.org/linux/man-pages/man7/lvmthin.7.html) | LVM thin provisioning. Used by [PPB](postgres-physical-backup.md). |

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
Defined in [TRO](tamanu/renderer-rollout.md#channels).

### Channel

A named stream of renderer builds, `canary` or `stable`, that a Tamanu deployment is rendered by.
Defined in [TRO](tamanu/renderer-rollout.md#channels).

### Promotion

The act of moving a channel tag to a renderer build, with the steps that make deployments on that channel render with it.
Defined in [TRO](tamanu/renderer-rollout.md#promotion).

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
