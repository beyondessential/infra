# Reference: k8s-core stack config

Top-level config of `pulumi/k8s-core`, under the `k8s-core:` namespace.
The authority is the code: `rg 'cfg\.(get|require)' pulumi/k8s-core`.
Defaults below were read from it; if they differ, the code wins.

## Keys

| key | default | effect | read in |
|---|---|---|---|
| `core` | required | Cross-stack reference to the account's core stack, `bes/core/<account>`. | `common/coreRef.ts` |
| `version` | required | EKS Kubernetes version. The Cluster resource ignores later changes to it, so editing it never upgrades AWS ([update procedure](../sops/update-k8s-cluster.md)). No minimum is enforced in code. | `cluster.ts` |
| `externalDnsZones` | required while `enableExternalDns` is true | Map of domain to Route 53 hosted zone id. Limits external-dns and, when both are on, cert-manager's Route 53 write permission to those zones. | `externalDns.ts` |
| `bootstrap` | `false` | Initial desired size of the bootstrap nodegroups: `true` gives 1, `false` gives 0. The nodegroups exist either way, and Pulumi ignores later changes to the desired size ([scale procedure](../sops/scale-bootstrap-nodegroups.md)). | `nodes/groups.ts` |
| `azLimit` | `2` | Number of AZs for the bootstrap nodegroups, capped at 2. | `nodes/groups.ts` |
| `withLaunchTemplate` | `true` | Bootstrap nodegroups use a custom launch template (IMDSv2 with IPv6, monitoring, 25 GiB encrypted gp3). When `false` the nodegroup name is not fixed by the code and `diskSize` 25 is used. | `nodes/groups.ts` |
| `useKarpenter` | `false` | Installs the Karpenter controller, node classes, node pools and placeholder Deployments. | `index.ts` |
| `workloadDiskGi` | `60` | Size in GiB of the data volume of nodes from the `workload`, `db-replica` and `db-critical` node classes. | `karpenter/classes.ts` |
| `envoyGatewayEnabled` | `false` | Turns on cert-manager's Gateway API integration here, and is read back by k8s-essentials to decide whether to install Envoy Gateway. | `index.ts`, `cert-manager/controller.ts` |
| `tailscaleProxyDefaultTags` | `[tag:k8s, tag:k8s-proxy]` | Tags on Tailscale proxy devices. Published as a stack output: k8s-essentials (operator `proxyConfig.defaultTags`), the Tamanu on-k8s stacks and Argo CD read it from here. The key of the same name in the k8s-essentials config is not read. | `index.ts` |
| `enableAwsLb` | `true` | AWS Load Balancer Controller. | `index.ts` |
| `enableCertManager` | `true` | cert-manager. | `index.ts` |
| `enableCertManagerPublic` | `true` | The `letsencrypt` ClusterIssuer (Route 53 DNS-01) and, with the EAB keys, `zerossl`. Needs `enableCertManager`. | `index.ts` |
| `enableExternalDns` | `true` | external-dns, restricted to `externalDnsZones`. | `index.ts` |
| `enableGP2Storage` | `false` | The legacy `ebs-gp2` and `ebs-gp2-imm` StorageClasses. `ebs-gp3` (the default class) and the `ebs` and `ebs-retain` VolumeSnapshotClasses are always created. | `storage/ebs.ts` |
| `enableEfsStorage` | `false` | Shared encrypted EFS filesystem, mount targets, and the `efs` StorageClass ([K8SVOL](../spec/kubernetes/volumes.md#multi-node-access)). | `index.ts`, `storage/efs.ts` |
| `enableEfsReclaim` | `false` | Delete a released claim's directory with its access point. The stack warns if the controller is not running with `--delete-access-point-root-dir=true`; on a cluster that has never run the driver this takes two passes ([K8SVOL](../spec/kubernetes/volumes.md#reclaim)). | `storage/efs.ts` |
| `s3buckets` | `[]` | When non-empty, installs the S3 CSI add-on with read and write on exactly these buckets. | `storage/s3.ts` |
| `zerosslEabKid` | unset | When set, creates the `zerossl` ClusterIssuer. | `cert-manager/zerossl.ts` |
| `zerosslEabKey` | required with `zerosslEabKid` | Secret. | `cert-manager/zerossl.ts` |

Provider keys (`aws:region`, `aws-native:region`, `awsx:region`, `pulumi:disable-default-providers`) are set in every stack file; see the shape below.

## Always on

Whatever the flags say, k8s-core creates: the cluster and its control plane role, the add-ons `vpc-cni`, `kube-proxy`, `coredns`, `aws-ebs-csi-driver`, `snapshot-controller` and `eks-node-monitoring-agent`, the bootstrap nodegroups, the spot service-linked role, the AWS Backup vault and plan, the backup bucket and its role, and the OpenCost role and export bucket.
A minimal cluster therefore still needs the core stack to publish `spotDataFeed` and, for IPv6, `eksCniV6Policy`.

## Shape

Bootstrap shape; values in angle brackets are per cluster.
Set it with `pulumi config set`; never commit a stack file.

```yaml
config:
  aws:region: ap-southeast-2
  awsx:region: ap-southeast-2
  aws-native:region: ap-southeast-2
  pulumi:disable-default-providers:
    - kubernetes
  k8s-core:core: bes/core/<account>
  k8s-core:version: "<kubernetes version>"
  k8s-core:externalDnsZones:
    <zone>: <hosted zone id>
  k8s-core:useKarpenter: "true"
  k8s-core:bootstrap: "true"
  k8s-core:envoyGatewayEnabled: "true"
  k8s-core:withLaunchTemplate: "false"
  k8s-core:tailscaleProxyDefaultTags:
    - tag:k8s-<cluster>
    - tag:k8s-<cluster>-proxy
```

A cluster that predates per-cluster tags may still use the unqualified defaults; a new cluster sets the per-cluster pair ([Tailscale registration](../sops/register-cluster-in-tailscale.md)).

## Outputs other stacks read

`name`, `tags`, `version`, `arn`, `endpoint`, `ca`, `coreStackName`, `region`, `backupsBucket`, `backupsServiceAccountArn`, `oidcProviderArn`, `opencostRoleArn`, `spotDataFeedBucketName`, `opencostExportBucketName`, `envoyGatewayEnabled`, `externalDnsZoneDomains`, `tailscaleProxyDefaultTags` (`pulumi/k8s-core/index.ts`, typed in `pulumi/common/CrossStack.ts`).
