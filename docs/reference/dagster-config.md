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
| Compute log bucket | `pulumi/data/dagster-infra/index.ts` | Private, encrypted, with no expiry, protected from deletion by the stack. Named by Pulumi; the name is the `computeLogsBucket` output. |
| IAM role `dagster` | `pulumi/data/dagster-infra/index.ts` | The role for the service account, with the compute log policy, and the RDS connect policy when IAM database authentication is on. |
| Shared names | `pulumi/constants/dagster.ts` | The service account name, compute log prefix and namespace derivation that both stacks use. |

The release is named `dagster` explicitly because the webserver Service is named from it, and `src/ingress.ts` points at that Service.

## Config keys

| stack | key | meaning |
|---|---|---|
| `dagster` | `dagster:k8s-core` | `bes/k8s-core/<stack>`; the cluster the stack applies to. |
| `dagster` | `dagster:infraStack` | `bes/dagster-infra/<stack>`; the AWS-side stack whose outputs the stack takes. It must have the same stack name as this stack. |
| `dagster` | `dagster:imageTag` | Tag of the data-lake image. Required. |
| `dagster` | `dagster:imagePullPat` | Secret registry token. Set it only while the image is private. |
| `dagster` | `dagster:dbDatabase` | Required. The storage database on the RDS instance, which differs between stacks (for example `dagster` and `dagster_dev`). Host, port and user come from the `dagster-infra` outputs. |
| `dagster` | `dagster:codeLocations` | Required list of code locations, each with exactly one of `file` or `package`, and optionally `memoryRequest`. See below. |
| `dagster` | `dagster:appEnvBlob` | Secret, one `KEY=VALUE` per line, for every code server. |
| `dagster` | `dagster:dagsterChartVersion` | Chart version. Defaults to the pin in `src/config.ts`. |
| `dagster` | `dagster:cpuRequest`, `memoryRequest`, `runPodCpuRequest`, `runPodMemoryRequest` | Resource requests of the long-lived pods and of run pods. |
| `dagster-infra` | `dagster-infra:core`, `k8s-core` | `bes/core/<account>` and `bes/k8s-core/<stack>`. |
| `dagster-infra` | `dagster-infra:dbInstanceIdentifier` | Required. The RDS instance's identifier (its name in the RDS console). |
| `dagster-infra` | `dagster-infra:dbUser` | Required. The only database user the role may connect as, and the user Dagster connects as. |

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
| `computeLogsBucket` | Name of the compute log bucket, which the `dagster` stack gives the compute log manager. |
| `dbHost` | The endpoint address of the RDS instance, which the pods connect to directly. |
| `dbPort` | The port of the RDS instance. |
| `dbUser` | The database user the role may connect as. |
| `region` | The region of the RDS instance, for the token exchange. |

## Database authentication

Dagster's storage connection uses a short-lived IAM token, so no stack holds a database password.
Neither stack manages the prerequisites, so all of them must hold before the first apply.

1. IAM database authentication is enabled on the RDS instance (its `iam_db_auth_enabled` setting).
2. A database administrator has run `GRANT rds_iam TO <dbUser>;` once against the instance, where `<dbUser>` is the Postgres role that Dagster connects as. Each database a stack names in `dagster:dbDatabase` must also exist and be accessible to that role.
3. The security group of the RDS instance allows port 5432 from the cluster's nodes.

The role gains `rds-db:connect` on that one user, looked up through the instance's resource id.
