# Reference: Dagster stacks

Where each part of [DAGS](../spec/data/dagster.md) lives in the two stacks, and the config keys and outputs that join them.
The requirements are in the spec.

## Parts

| part | stack and file | what it is |
|---|---|---|
| Namespace `dagster-<stack>` | `pulumi/data/dagster/src/namespace.ts` | One flat namespace, outside any HNC tree. |
| Helm release `dagster` | `src/helm.ts` | The Dagster chart, with the storage, compute log, run launcher and coordinator values. |
| Code servers | `src/codeLocations.ts` | One entry of the chart's `dagster-user-deployments` per code location. |
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
| `dagster` | `dagster:dbHost`, `dbPort`, `dbUser`, `dbDatabase` | The storage database as reached through the in-cluster database proxy. `dbPort` defaults to 5432. |
| `dagster` | `dagster:dbPassword` | Secret. Required unless the AWS-side stack has IAM database authentication on. |
| `dagster` | `dagster:appEnvBlob` | Secret, one `KEY=VALUE` per line, for every code server. |
| `dagster` | `dagster:dagsterChartVersion` | Chart version. Defaults to the pin in `src/config.ts`. |
| `dagster` | `dagster:namespace` | Overrides the namespace suffix. |
| `dagster` | `dagster:cpuRequest`, `memoryRequest`, `runPodCpuRequest`, `runPodMemoryRequest` | Resource requests of the long-lived pods and of run pods. |
| `dagster-infra` | `dagster-infra:core`, `k8s-core` | `bes/core/<account>` and `bes/k8s-core/<stack>`. |
| `dagster-infra` | `dagster-infra:computeLogsBucket` | Name of the bucket the `data/bucket` stack owns. |
| `dagster-infra` | `dagster-infra:namespacePattern` | Namespaces whose `dagster` service account may assume the role. Defaults to `dagster-*`. |
| `dagster-infra` | `dagster-infra:dbIamAuth` | Whether Dagster authenticates to its storage with IAM. Defaults to off. |
| `dagster-infra` | `dagster-infra:dbInstanceIdentifier`, `dbUser` | Read only when `dbIamAuth` is on. `dbUser` must be the same as `dagster:dbUser`. |

## Outputs of `dagster-infra`

| output | meaning |
|---|---|
| `dagsterRoleArn` | ARN of the role, which the `dagster` stack puts on the service account. |
| `computeLogsBucket` | Compute log bucket, which the `dagster` stack gives the compute log manager. |
| `dbIamAuth` | Whether IAM database authentication is on, which the `dagster` stack follows. |
| `region` | The region of the RDS instance, for the token exchange. |

## Turning on IAM database authentication

Two things outside both stacks must hold first: IAM database authentication enabled on the RDS instance, and `GRANT rds_iam TO <dbUser>` run once by a database administrator.
Then set `dagster-infra:dbIamAuth`, apply `dagster-infra`, and apply `dagster`, which picks the setting up from the outputs and no longer needs `dbPassword`.
