---
id: DAGS
---

# Dagster on Kubernetes

The requirements in this spec apply to the infrastructure that runs one instance of [Dagster](https://docs.dagster.io/) for the data team's data-lake project on a Kubernetes cluster: its namespace, its workloads and their identities, the storage it uses, and how people and automation reach it.
What the code locations compute is specified by data-lake, and this spec does not restate it.

## Borrowed terms

| term | meaning |
|---|---|
| code location, code server | A code location is a set of definitions that Dagster loads from one Python file or package. A code server is the process that serves one code location to the rest of the instance ([Dagster code locations](https://docs.dagster.io/deployment/code-locations)). |
| run, run launcher, run coordinator | A run is one execution of a job or materialisation. The run launcher starts it, and the run coordinator decides when it may start ([Dagster run launchers](https://docs.dagster.io/deployment/execution/run-launcher), [run coordinators](https://docs.dagster.io/deployment/execution/run-coordinator)). |
| compute log manager | The component that stores the standard output and error of a run ([Dagster compute log storage](https://docs.dagster.io/deployment/dagster-instance#compute-log-storage)). |
| Dagster Helm chart | The chart that the Dagster project publishes for deploying an instance on Kubernetes ([Deploying Dagster on Helm](https://docs.dagster.io/deployment/oss/deployment-options/kubernetes/deploying-to-kubernetes)). |
| IAM role for a service account | An IAM role that the pods of a Kubernetes service account assume by web identity through the OIDC provider of the Kubernetes cluster ([IAM roles for service accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)). |
| IAM database authentication | The RDS mode in which a database user connects with a short-lived token that IAM issues, instead of a stored password ([IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)). |

## Instance

An instance of Dagster MUST run in its own namespace.

The namespace MUST be named `dagster-` followed by the normalised stack name, unless the stack's configuration names it explicitly.

The normalised stack name MUST be derived from the stack name by the following steps, in order:

1. The stack name is lowercased.
2. Each run of characters other than `a` to `z`, `0` to `9` and `-` is replaced by one `-`.
3. Trailing `-` characters are removed.
4. The result is truncated to 55 characters.
5. Leading and trailing `-` characters are removed.

The instance MUST be deployed from the Dagster Helm chart, at an exact version.

The chart version SHOULD be the version of Dagster that data-lake locks.

The stack that runs the instance is subject to the requirements of [K8SNSP](../kubernetes/namespaces.md#cluster-endpoint-access) on cluster endpoint access.

## Code locations

The instance MUST run one code server for each code location that the stack's configuration lists.

A code location in the configuration is loaded from a Python file or from a Python package, resolved from the working directory of the image.

The name of a code server MUST be the name of its file without directories or `.py`, or of its package, with each `_` replaced by `-`.

A code location whose name is not a valid [DNS label](https://www.rfc-editor.org/rfc/rfc1035#section-2.3.1) that begins with a letter, or whose name is the same as another's in the configuration, MUST fail the stack before it changes anything.

A code location's configuration MAY set its memory request, which replaces the default.

Every code server MUST run the data-lake image `ghcr.io/beyondessential/data-lake-dagster` at one image tag that the stack's configuration names.

The stack MUST be able to pull the image with a registry credential, and MUST NOT require one when the image is public.

Every code server MUST receive the same environment variables, which the stack builds from one secret value of lines of the form `KEY=VALUE`.

Blank lines and lines that begin `#` in that value MUST be ignored.

A line of that value that has no `=` MUST fail the stack before it changes anything.

The environment variables of the code servers MUST NOT include the storage credentials or the name of the compute log bucket.

## Storage

The instance MUST keep its runs, event logs and schedule state in the PostgreSQL database that the stack's configuration names, on the data-warehouse RDS instance.

The instance MUST NOT run a database of its own.

The instance MUST reach the database through the cluster's database proxy Service, and MUST NOT connect to the RDS endpoint directly.

> [!NOTE]
> The cluster is IPv6-only and the RDS endpoint resolves dual-stack, which the Tailscale operator cannot proxy directly.

When IAM database authentication is enabled for the instance, Dagster MUST authenticate to the database with a token issued to the IAM role of its service account, and the stack MUST NOT hold a database password.

When IAM database authentication is enabled, the stack MUST refuse to apply when the database user it connects as is not the user that the AWS-side stack publishes.

When IAM database authentication is not enabled, the stack MUST hold the database password as a secret value.

> [!NOTE]
> IAM database authentication needs the RDS instance to have the feature enabled and the database user to have been granted `rds_iam`.
> Neither the stack nor the AWS-side stack manages either.

## Compute logs

The compute log manager MUST store the compute logs of runs in the S3 bucket that the AWS-side stack names, under the key prefix `dagster-compute-logs/`.

## Run launcher

Each run MUST execute in its own pod, in the namespace of the instance.

Every pod of the instance MUST be scheduled onto nodes of the architecture that the data-lake image is built for.

Run pods MUST be scheduled onto on-demand workload capacity.

The webserver, the daemon and the code servers SHOULD prefer spot workload capacity, and MAY run on on-demand capacity.

The run coordinator MUST queue runs and MUST start at most two at a time.

The run coordinator MUST start at most one run that is tagged as a backfill, at most one run tagged `processing_load` with the value `heavy`, and at most one run for each value of the tag `database`.

Run monitoring MUST be on, and a failed run MUST be retried once.

The instance MUST purge its records by age as the following table gives.

| record | age at purge |
|---|---|
| schedule ticks | 14 days |
| sensor ticks that were skipped or failed | 1 day |
| sensor ticks that succeeded | 7 days |
| auto-materialise ticks | 7 days |

## Access

The webserver MUST be reachable only through the tailnet, at an Ingress of the `tailscale` [IngressClass](https://kubernetes.io/docs/concepts/services-networking/ingress/) whose hostname is the name of the namespace of the instance.

The tailnet device of that Ingress MUST carry the tag `tag:dagster`.

The access group `tailscale:gha:dagster` is held by the data-lake workflow that applies the stack.
The bindings of that group are those [K8SNSP](../kubernetes/namespaces.md#access-groups) gives.

The stack MUST bind `tailscale:gha:dagster` to `cluster-admin` by a RoleBinding in the namespace of the instance.

The stack MUST grant `tailscale:gha:dagster` the verbs `get`, `list`, `watch`, `create`, `update` and `patch` on namespaces, by a ClusterRole and a ClusterRoleBinding, and nothing else cluster-wide.

The workflow MUST NOT be able to delete a namespace.

> [!NOTE]
> The workflow holds only what those bindings grant, so it cannot create them.
> The first apply of a stack is made by an operator who holds `cluster-admin` cluster-wide, and every later apply can come from the workflow.

## AWS identity

The AWS-side stack is a separate stack from the one that runs the instance, applied in the AWS account of the cluster with AWS credentials.

The namespace of the instance MUST hold a service account named `dagster`, annotated with the ARN of the IAM role that the AWS-side stack provides.

The webserver, the daemon, the code servers and the run pods MUST run as that service account.

The AWS-side stack MUST provide one IAM role for a service account, assumable only by web identity from the OIDC provider of the cluster, for the service account `dagster` in a namespace whose name matches `dagster-*` or the pattern that the AWS-side stack's configuration names.

The role MUST permit listing the compute log bucket, and reading and writing the objects of that bucket under the compute log prefix, and MUST NOT permit deleting them.

When IAM database authentication is enabled, the role MUST permit connecting to the RDS instance as the database user of the instance, and as no other user.

The role MUST hold no permission beyond those this section gives.

The AWS-side stack MUST publish the ARN of the role, the name of the compute log bucket, whether IAM database authentication is enabled, the database user the role may connect as when it is, and its region, and the stack that runs the instance MUST take those values from the AWS-side stack's outputs and from no other source.
