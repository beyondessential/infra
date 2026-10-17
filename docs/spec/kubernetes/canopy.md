---
id: K8SCNP
---

# Canopy on Kubernetes

The requirements in this spec apply to the infrastructure that runs one instance of [Canopy](../overview.md#canopy) on a Kubernetes cluster: its namespace, its workloads and their identities, its database, its hostnames, and what it publishes.
What each Canopy workload does is specified by Canopy, and this spec cites those specs rather than restating them.
The DNS zones Canopy writes to, the identity it writes with and the certificate authority it orders from are specified in [CTLS](../canopy/tls-issuance.md).

## Borrowed terms

| term | meaning |
|---|---|
| service account | The identity a pod runs as, which the API server authenticates and a RoleBinding can name as a subject ([Kubernetes service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)). |
| IAM role for a service account | An IAM role that the pods of a Kubernetes service account assume by web identity through the OIDC provider of the Kubernetes cluster ([IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)). |
| Deployment, Job, CronJob | The Kubernetes controllers for a long-running workload, a run-to-completion workload, and a workload run on a schedule ([Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/), [CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)). |
| ClusterRole, RoleBinding, ClusterRoleBinding, `cluster-admin` | The RBAC objects of Kubernetes and the built-in role that permits every action ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)). |
| workload identity, API server proxy | A credential issued to one run of a workflow, and the Tailscale operator mode that forwards Kubernetes API requests from the tailnet ([Tailscale workload identity federation](https://tailscale.com/kb/1581/workload-identity-federation), [API server proxy](https://tailscale.com/kb/1437/kubernetes-operator-api-server-proxy)). |
| cluster, Pooler | A CloudNativePG `Cluster` resource, and the `Pooler` resource that runs PgBouncer in front of one ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). Within this spec the word cluster alone never means a Kubernetes cluster. |
| Gateway, listener, HTTPRoute | The Gateway API objects that terminate TLS for a hostname and route its requests ([Gateway API](https://gateway-api.sigs.k8s.io/)). |
| IngressClass | The Kubernetes object that names the controller an Ingress is served by ([Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)). |
| output | A named value a [stack](../overview.md#stack) publishes for other stacks to read ([Stack outputs](https://www.pulumi.com/docs/iac/concepts/stacks/#outputs)). |

## Instance

A [Canopy stack](../overview.md#canopy-stack) is the stack that runs one instance of Canopy on one Kubernetes cluster.

A Canopy stack MUST run exactly one instance of Canopy.

The namespace of a Canopy stack MUST be named `tamanu-meta-` followed by the stack name.

The namespace MUST stand outside the tree of the [super namespace](../overview.md#super-namespace), as [K8SNSP](namespaces.md#namespace-tree) requires.

A Canopy stack MUST create its namespace, the RoleBinding that grants `cluster-admin` in that namespace to the access group `tailscale:gha:canopy`, the ClusterRole `tamanu-meta-gha-canopy-ns`, and the ClusterRoleBinding of that ClusterRole to the same group.

> [!NOTE]
> The identity that applies the stack from a workflow holds only what those bindings grant, and cannot create them.
> The first apply of a Canopy stack is therefore made by an operator who holds `cluster-admin` cluster-wide, and every later apply can come from the workflow.

A Canopy stack MUST refuse to apply against a cluster other than the one its configuration names, as [K8SNSP](namespaces.md#cluster-endpoint-access) requires of every stack that manages in-cluster resources.

Every workload of a Canopy stack MUST run the Canopy image at one image tag.

## Workloads

A Canopy stack MUST run the workloads in the following table, each as the service account given.

| workload | kind | service account | IAM role | Secret access in the namespace | what it does |
|---|---|---|---|---|---|
| public server | Deployment | `canopy-issuer` | `canopy-issuer` | read | Serves devices: authenticates them ([Canopy DTR](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/device-trust.md#authentication)), issues their certificates ([CRT](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md)), registers their addresses ([ADR](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/addresses.md)), credentials their backups ([BAK](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/backup.md#credentials)), takes their statuses ([STA](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/statuses.md)) and serves them artifacts ([ART](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/platform/artifacts.md)). |
| private server | Deployment | `canopy-private` | `canopy-private` | read, create, patch, delete | Serves operators: the administration interface and API ([ADM](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/admin-access.md)) and the fleet query interface ([MCP](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/mcp.md)). |
| monitor | Deployment | the default | none | none | Determines Canopy's own checks and opens and closes incidents ([CHK](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/monitoring/checks.md), [INC](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/monitoring/incidents.md)). |
| backups | Deployment | `canopy-jobs` | `canopy-jobs` | read, create, update, patch | Maintains, inspects and meters the backup repositories of groups ([BKJ](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/jobs/backup.md)), writes the recovery escrow ([ESC](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/jobs/escrow.md)) and sweeps artifact bytes no registration reaches ([ART](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/platform/artifacts.md#where-an-artifact-rests)). |
| domains | Deployment | `canopy-domains` | `canopy-domains` | none | Writes the address records of registered names ([ADR](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/addresses.md#registering)) and drives certificate orders through the DNS-01 challenge ([CRT](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md)). |
| slacker | Deployment | the default | none | none | Delivers the notifications of incidents, maintenance windows and self-alerts to the notification channels ([INC](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/monitoring/incidents.md#notification), [MNT](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/monitoring/maintenance.md#notification), [SELF](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/self-alerts.md#notification)). |
| migrate | Job | the default | none | none | Applies the database migrations of the image tag. |
| chrome versions | CronJob, daily | the default | none | none | Refreshes the record of browser releases that the public server presents. |
| history partitions | CronJob, daily | the default | none | none | Provisions ahead the ranges of the status and device-connection histories ([HST](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/platform/history-storage.md#provisioning-ahead)). |

A service account in the table MUST carry the annotation `eks.amazonaws.com/role-arn` naming its IAM role, which [canopy-infra](#canopy-infra) provides.

A service account in the table MUST be bound in the namespace to a Role that grants exactly the Secret access the table gives, and to no other Role.

A workload whose IAM role is none MUST run as the default service account of the namespace.

The public server and the private server SHOULD each run two replicas.

The monitor, backups, domains and slacker workloads MUST each run one replica, replaced rather than overlapped on update.

> [!NOTE]
> Each of the four holds work that at most one instance may drive at a time, and none is on a request path, so a brief gap on update delays work rather than failing it.

A Deployment of a Canopy stack MUST NOT start before the migrate Job of the same apply has completed.

The domains workload is the [Canopy DNS identity](../overview.md#canopy-dns-identity), whose access [CTLS](../canopy/tls-issuance.md#zone-access) specifies.

Every workload MUST receive the managed zone list as [CTLS](../canopy/tls-issuance.md#managed-zones) specifies.

The domains workload and the private server MUST receive the certificate authority account as [CTLS](../canopy/tls-issuance.md#certificate-authority-account) specifies.

The public server, the private server and the backups workload MUST receive the same [artifact store](#artifact-store).

Where a Canopy stack names a recovery vault, the backups workload MUST receive the vault and the recipient keys, and the private server MUST receive the recipient keys.

Where a Canopy stack names a shared backups stack, the backups workload MUST receive its provisioner, maintenance and device roles, and the public server MUST receive its device role.

## Database

A Canopy stack MUST have one cluster named `meta-db` in its namespace, whose parameters [K8SPGC](postgres.md) governs.

The cluster MUST have two instances.

The cluster MUST opt into the [critical database pool](../overview.md#critical-database-pool), as [K8SPGC](postgres.md#scheduling-and-disruption) provides.

The cluster MUST archive to the [backup bucket](../overview.md#backup-bucket) of its Kubernetes cluster under the deployment name `tamanu-meta-` followed by the stack name, as [K8SBAK](database-backups.md#object-layout) gives.

The recovery window of the cluster is the one [K8SBAK](database-backups.md#recovery-window) gives for the Canopy meta database.

A Canopy stack MUST have a read-write Pooler named `meta-pooler-rw` and a read-only Pooler named `meta-pooler-ro` in front of the cluster, each of two instances in transaction pooling mode.

The Poolers MUST run on the critical database pool, and each MUST keep one instance available through a node drain.

The public server, the private server, the monitor, the backups workload, the domains workload and the slacker workload MUST reach the database through the Poolers.

The migrate Job and the CronJobs MUST reach the database directly.

> [!NOTE]
> A switchover of the primary costs a pooled service only the queries in flight, where a direct connection is dropped.
> A migration needs a session, which transaction pooling does not keep.

A Canopy stack MAY expose a replica of the cluster on the tailnet at the hostname `tamanu-meta-` followed by the stack name and `-db`.

## Public hostnames

[tamanu-meta](../overview.md#tamanu-meta) is the public server of a Canopy stack as devices reach it at its public hostnames over the internet, authenticating with a TLS client certificate.

A Canopy stack MUST have at least one public hostname.

The public hostnames of a Canopy stack SHOULD default to `meta-` followed by the stack name, under `cd.tamanu.app`.

The first public hostname MUST be the canonical origin of the instance, at which the public server names artifact locations and feed links.

A Canopy stack MUST have one Gateway of the class [K8SING](ingress.md#gateway) requires, with a listener on TCP 443 for each public hostname and for its alias, which is `gw.` followed by the hostname.

The certificate of each listener MUST be provisioned as [K8SING](ingress.md#certificates) requires.

The listeners serving tamanu-meta are the listeners of the public hostnames and their aliases, and the requirements of [K8SING](ingress.md#client-certificates) apply to each of them.

An HTTPRoute of the Gateway MUST route each public hostname and each alias to the public server.

A route to the public server MUST allow a request 60 seconds.

external-dns MUST publish the public hostnames and their aliases as [K8SING](ingress.md#dns) requires.

## Tailnet hostnames

The private server MUST be reachable only through the tailnet, at an Ingress of the `tailscale` IngressClass whose hostname the stack configures.

> [!NOTE]
> The Tailscale operator sets the caller's identity on each request, and the private server resolves administrators from it as [Canopy ADM](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/admin-access.md#who-is-an-administrator) specifies.

The tailnet hostname `tamanu-meta-` followed by the stack name MUST answer every request with a permanent redirect to the same path at the hostname of the private server.

The tailnet devices of a Canopy stack MUST carry the tags in the following table.

| device | tags |
|---|---|
| the Ingress of the private server, and the redirect | `tag:tools`, `tag:server`, `tag:server-tamanu`, `tag:server-tamanu-meta` |
| the exposed database replica | `tag:k8s-proxy`, `tag:server`, `tag:server-tamanu`, `tag:server-tamanu-meta` |

## canopy-infra

The canopy-infra stack of a Canopy stack is the stack in the AWS account of the Kubernetes cluster that provides the IAM roles and the artifact store of that Canopy stack.

A canopy-infra stack MUST have the same stack name as its Canopy stack.

A canopy-infra stack MUST provide the IAM roles for service accounts in the following table.

| role | trusted service account | permissions |
|---|---|---|
| `canopy-issuer` | `canopy-issuer` | `sts:AssumeRole` on any role, and the artifact store. |
| `canopy-jobs` | `canopy-jobs` | `sts:AssumeRole` on any role, and the artifact store. |
| `canopy-private` | `canopy-private` | `sts:AssumeRole` on any role, and the artifact store. |
| `canopy-domains` | `canopy-domains` | `sts:AssumeRole` on any role, and the zone of the account's [core](../overview.md#core) as [CTLS](../canopy/tls-issuance.md#zone-access) gives. |

A role MUST be assumable only by web identity from the OIDC provider of the Kubernetes cluster, for its trusted service account in the namespace of the Canopy stack.

A role MUST hold no permission beyond those the table gives.

> [!NOTE]
> The `sts:AssumeRole` permission names no role.
> The roles that a device role, a maintenance role or a zone role trusts are decided by the trust policy of each, in the stack that owns the bucket or the zone.
> Which roles [LNXBAK](../linux/backups.md#repository-roles) names in those trust policies is specified there.

## Artifact store

The artifact store of a Canopy stack is the S3 bucket, region and key prefix under which Canopy holds the bytes of the artifacts it serves, as [Canopy ART](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/platform/artifacts.md#where-an-artifact-rests) specifies.

A canopy-infra stack MUST provide one artifact store, in its own account.

The artifact store MUST block all public access.

Objects in the artifact store MUST be encrypted at rest.

The artifact store MUST abort an incomplete multipart upload one day after it is initiated.

The artifact store MUST NOT expire an object by age.

The artifact store MUST be protected from deletion by the stack that owns it.

The key prefix of the artifact store MUST be `artifacts/`.

The permission of a role on the artifact store MUST be to list the bucket and to read, write and delete its objects, and no other.

## Access

The access group `tailscale:gha:canopy` is held by the workflow that deploys Canopy, which builds the image, joins the tailnet with a workload identity, reaches the cluster through the API server proxy, and applies the Canopy stack with the image tag it built.

The bindings of `tailscale:gha:canopy` are those [K8SNSP](namespaces.md#access-groups) gives.

The ClusterRole `tamanu-meta-gha-canopy-ns` MUST grant the verbs `get`, `list`, `watch`, `create`, `update` and `patch` on namespaces, and nothing else.

The workflow MUST NOT be able to delete a namespace.

## Outputs

A Canopy stack MUST publish the outputs of the following table, under the names given.

| output | meaning |
|---|---|
| `domains` | The public hostnames of the instance, the canonical origin first. |

A canopy-infra stack MUST publish the outputs of the following table, under the names given.

| output | meaning |
|---|---|
| `canopyIssuerRoleArn` | The ARN of the `canopy-issuer` role. |
| `canopyJobsRoleArn` | The ARN of the `canopy-jobs` role. |
| `canopyPrivateRoleArn` | The ARN of the `canopy-private` role. |
| `canopyDomainsRoleArn` | The ARN of the `canopy-domains` role, which is the Canopy DNS identity. |
| `canopyArtifactBucket` | The bucket of the artifact store. |
| `canopyArtifactRegion` | The region of the artifact store. |
| `canopyArtifactPrefix` | The key prefix of the artifact store. |

A stack that trusts a Canopy role, whether a core creating its [zone role](../overview.md#zone-role) or a deployment creating the roles of its [repository bucket](../overview.md#repository-bucket), MUST read the ARN of that role from the outputs of the canopy-infra stack.
