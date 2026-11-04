# Reference: Dagster stacks

Where each part of [DAGS](../spec/data/dagster.md) lives in the two stacks, and the config keys and outputs that join them.
The requirements are in the spec.

## Parts

| part | stack and file | what it is |
|---|---|---|
| Namespace `dagster-<stack>` | `pulumi/data/dagster/src/namespace.ts` | One flat namespace, outside any HNC tree. |
| Helm release `dagster` | `src/helm.ts` | The Dagster chart, with the storage, compute log, run launcher and coordinator values. |
| Code servers | `src/codeLocations.ts` | One entry of the chart's `dagster-user-deployments` per entry of `codeLocations`. |
| Environment Secret | `src/secrets.ts` | The parsed `appEnvBlob`, mounted into every code server. The registry Secret exists only when `imagePullPat` is set. |
| Service account `dagster` | `src/serviceAccount.ts` | Annotated with the role ARN from the AWS-side stack. |
| Tailnet Ingress | `src/ingress.ts` | Hostname `dagster-<stack>`, tag `tag:dagster`. |
| `tailscale:gha:dagster` bindings | `src/rbac.ts` | The RoleBinding to `cluster-admin`, and the ClusterRole over namespaces. |
| IAM role `dagster` | `pulumi/data/dagster-infra/index.ts` | The role for the service account, with the compute log policy, and the RDS connect policy when IAM database authentication is on. |
| Shared names | `pulumi/constants/dagster.ts` | The service account name, namespace pattern and compute log prefix that both stacks use. |

The release is named `dagster` explicitly because the webserver Service is named from it, and `src/ingress.ts` points at that Service.

## Config keys

| stack | key | meaning |
|---|---|---|
| `dagster` | `dagster:k8s-core` | `bes/k8s-core/<stack>`; the cluster the stack applies to. |
| `dagster` | `dagster:infraStack` | `bes/dagster-infra/<stack>`; the AWS-side stack whose outputs the stack takes. |
| `dagster` | `dagster:imageTag` | Tag of the data-lake image. Required. |
| `dagster` | `dagster:imagePullPat` | Secret registry token. Set it only while the image is private. |
| `dagster` | `dagster:dbUrl` | Secret. The storage database as `postgres://user[:password]@host[:port]/database`, with the host the in-cluster database proxy Service, as `<name>.<namespace>.svc.cluster.local` (or ending `.svc`). The port defaults to 5432. The password is required unless the AWS-side stack has IAM database authentication on, and is rejected when it does. |
| `dagster` | `dagster:codeLocations` | Required list of code locations, each with exactly one of `file` or `package`, and optionally `memoryRequest`. See below. |
| `dagster` | `dagster:appEnvBlob` | Secret, one `KEY=VALUE` per line, for every code server. |
| `dagster` | `dagster:dagsterChartVersion` | Chart version. Defaults to the pin in `src/config.ts`. |
| `dagster` | `dagster:namespace` | Overrides the namespace suffix. |
| `dagster` | `dagster:cpuRequest`, `memoryRequest`, `runPodCpuRequest`, `runPodMemoryRequest` | Resource requests of the long-lived pods and of run pods. |
| `dagster-infra` | `dagster-infra:core`, `k8s-core` | `bes/core/<account>` and `bes/k8s-core/<stack>`. |
| `dagster-infra` | `dagster-infra:computeLogsBucket` | Name of the bucket the `data/bucket` stack owns. |
| `dagster-infra` | `dagster-infra:namespacePattern` | Namespaces whose `dagster` service account may assume the role. Defaults to `dagster-*`. |
| `dagster-infra` | `dagster-infra:dbIamAuth` | Whether Dagster authenticates to its storage with IAM. Defaults to off. |
| `dagster-infra` | `dagster-infra:dbInstanceIdentifier`, `dbUser` | Read only when `dbIamAuth` is on. The `dagster` stack refuses a `dagster:dbUrl` whose user is not `dbUser`. |

## Code locations

The list follows `dagster/workspace.yaml` in data-lake, and nothing checks the two against each other.
A `python_file` entry there is a `file` here, and a `python_package` entry is a `package`.
A location that imports several countries' dbt projects at startup needs a larger `memoryRequest`.

```yaml
config:
  dagster:codeLocations:
    - file: global_definitions.py
    - package: bes
    - package: tamanu_analytics
      memoryRequest: 1Gi
```

## Outputs of `dagster-infra`

| output | meaning |
|---|---|
| `dagsterRoleArn` | ARN of the role, which the `dagster` stack puts on the service account. |
| `computeLogsBucket` | Compute log bucket, which the `dagster` stack gives the compute log manager. |
| `dbIamAuth` | Whether IAM database authentication is on, which the `dagster` stack follows. |
| `dbUser` | The database user the role may connect as, when IAM database authentication is on. The `dagster` stack checks the user in `dagster:dbUrl` against it. |
| `region` | The region of the RDS instance, for the token exchange. |

## Turning on IAM database authentication

Dagster's storage connection can use a short-lived IAM token instead of a stored password.
It is off by default.
Neither stack manages the two prerequisites, so both must hold before the setting is turned on.

1. IAM database authentication is enabled on the data-warehouse RDS instance (its `iam_db_auth_enabled` setting).
2. A database administrator has run `GRANT rds_iam TO <dbUser>;` once against the instance, where `<dbUser>` is the Postgres role that Dagster connects as.

Then:

1. Set `dagster-infra:dbIamAuth` to `true`, `dagster-infra:dbInstanceIdentifier` to the instance's identifier (its name in the RDS console), and `dagster-infra:dbUser` to the user in `dagster:dbUrl`.
2. Apply `dagster-infra`. The role gains `rds-db:connect` on that one user, looked up through the instance's resource id.
3. Apply `dagster`. It reads `dbIamAuth` and the region from the outputs, switches the chart to AWS workload identity authentication, and the URL no longer carries a password.
