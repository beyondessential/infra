# Our Kubernetes Setup

Two Pulumi stacks per cluster, layered:

1. **`pulumi/k8s-core/`** — the EKS cluster itself, node groups, storage, load balancer, cert-manager, external-dns, cluster-level IAM, AWS Backup, and the backup S3 bucket. **Requires AWS credentials** to run — it provisions AWS resources.
2. **`pulumi/k8s-essentials/`** — everything that runs on top as shared cluster services: ingress (NGINX or Envoy Gateway), Tailscale operator, Prometheus + OpenCost, CloudNativePG, HNC, and RBAC for teams. **Does not require AWS access** — it only talks to the Kubernetes API, which is reachable over the Tailscale operator proxy. This is the whole reason for the split: engineers without AWS access can still manage and upgrade shared cluster services.

We currently run two clusters, both in `ap-southeast-2`:

- `tamanu-internal-main` — production-ish, full feature set, hosts all Tamanu preview/demo/release deployments. Cross-stack name `bes/k8s-core/tamanu-internal-main`.
- `data-internal-data` — data team's cluster; stripped down, cost-optimised, no HNC/NGINX/public cert-manager. `bes/k8s-core/data-internal-data`.

Nodes run **Bottlerocket** (`BOTTLEROCKET_ARM_64` / `BOTTLEROCKET_x86_64`) — the custom Ubuntu AMI in [`beyondessential/linux-images`](https://github.com/beyondessential/linux-images) is only for the Linux-server variant of Tamanu, not Kubernetes. Tailscale ACL policy lives in [`beyondessential/tailscale`](https://github.com/beyondessential/tailscale/).

---

## 1. k8s-core

### 1.1 Module wiring (`index.ts`)

Order: account check → `cluster.ts` → AWS-managed addons → nodes (bootstrap-only managed nodegroup, plus Karpenter when `useKarpenter: true`) → storage → load balancer → cert-manager → external-dns → OpenCost role → backup bucket → AWS Backup.

All feature modules are behind config flags, so a minimal cluster (data team style) just creates the EKS control plane and Karpenter.

Exports used by downstream stacks: `coreStackName`, `region`, cluster `arn`/`endpoint`/`ca`, `backupsBucket`, `backupsServiceAccountArn`, `oidcProviderArn`, `opencostRoleArn`.

### 1.2 Top-level knobs

Under the `k8s-core:` config namespace.

| Key | Default | Notes |
|---|---|---|
| `version` | **required** | EKS Kubernetes version (e.g. `1.33`, `1.34`). Must be ≥ 1.21. |
| `azLimit` | all VPC AZs | Cap number of AZs (cost control; applies to bootstrap nodegroup). |
| `bootstrap` | `false` | Adds a one-shot managed system nodegroup for cluster creation. Flip on for `pulumi up` of a fresh cluster, off after Karpenter has migrated onto its own nodes. See §3.1. |
| `withLaunchTemplate` | `true` | Custom launch template (IPv6 IMDS, configurable disk) for the bootstrap nodegroup. |
| `useKarpenter` | `false` | Karpenter controller + NodePools. Set to `true` after the cluster is up; cluster creation typically pairs with `bootstrap: true` for the seed node, then both flip together later. |
| `envoyGatewayEnabled` | `false` | Source-of-truth for Envoy Gateway. k8s-core uses it to gate cert-manager's Gateway API integration; k8s-essentials reads it back via the cross-stack ref to gate the Envoy Gateway install itself. Setting `true` here is necessary to avoid cert-manager crash-looping on its Gateway-CRD preflight when Envoy Gateway is on. |
| `enableAwsLb` | `true` | AWS Load Balancer Controller (for ALB/NLB provisioning). |
| `enableCertManager` | `true` | cert-manager. |
| `enableCertManagerPublic` | `true` | Let's Encrypt + optional ZeroSSL ClusterIssuers. |
| `enableExternalDns` | `true` | external-dns syncing to Route53. |
| `externalDnsZones` | required if above | Map of domain → Route53 zone ID. |
| `enableGP2Storage` | `false` | Provision the legacy `ebs-gp2`/`ebs-gp2-imm` StorageClasses. `ebs-gp3` is always on. |
| `enableEfsStorage` | `false` | Shared EFS filesystem + `efs` StorageClass, for `ReadWriteMany` claims (Tamanu's blob store). |
| `enableEfsReclaim` | `false` | Delete a released claim's directory with its access point. Safe only where each access point is confined to its own claim's directory, as the `efs` StorageClass arranges. |
| `s3buckets` | `[]` | If non-empty, deploys the S3 CSI driver with read/write to these buckets. |
| `zerosslEabKid`, `zerosslEabKey` | — | Secret EAB creds; if set, adds a ZeroSSL ClusterIssuer. |

### 1.3 EKS cluster (`cluster.ts`)

- Control plane role: `EKS{PascalStackName}ControlPlane-` with `AmazonEKSClusterPolicy`.
- Private **and** public endpoint access always on.
- Dualstack IPv4/IPv6 automatically when the referenced VPC has a v6 CIDR (the Ubuntu AMI and CNI are v6-ready).
- Addons (AWS-managed, auto-versioned, `ignoreChanges` on version): `vpc-cni`, `kube-proxy`, `coredns`, plus EBS CSI. The `addAddon()` helper auto-detects the latest compatible version.
- OIDC provider always created — IRSA is the standard auth for pod IAM.

### 1.4 Nodes (`nodes/groups.ts`, `karpenter/`)

Node provisioning is fully Karpenter-managed. `nodes/groups.ts` is now just the bootstrap mechanism: a single managed nodegroup gated on `bootstrap: true`, used only during initial cluster creation (see §3.1). Steady-state clusters have `bootstrap: false` and zero managed nodegroups.

NodePools are defined in `karpenter/pools.ts`, cut three ways: **purpose** × **schedule** × **architecture**.

- Purposes: `workload`, `ingress` (in NAT subnets), `system` (core cluster addons).
- Schedules: `ondemand`, `spot` (spot carries `PreferNoSchedule`).
- Arches: `arm64` (Graviton, default everywhere), `amd64` (workload pools only).

| NodePool | Purpose | Schedule | Arch | Weight |
|---|---|---|---|---|
| `workload-arm-spot` | workload | spot | arm64 | 80 |
| `workload-x86-spot` | workload | spot | amd64 | 60 |
| `ingress-arm` | ingress | mixed | arm64 | 50 |
| `system-arm-spot` | system | spot | arm64 | 45 |
| `system-arm` | system | on-demand | arm64 | 40 |
| `workload-arm-ondemand` | workload | on-demand | arm64 | 30 |
| `workload-x86-ondemand` | workload | on-demand | amd64 | 10 |

Higher weight wins when multiple pools satisfy a pod's requirements. The `system-arm` on-demand pool is unconditional — it provides a stable fallback for the Karpenter controller and other cluster-critical pods even when the spot pool is exhausted (see [K8SNOD](spec/kubernetes/nodes.md#system-capacity)).

Every node carries `bes.node.group`, `bes.node.purpose`, `bes.node.schedule`, `bes.node.arch` labels — pod affinities target these. Spot nodes carry the `spotInstance=true:PreferNoSchedule` taint.

EC2NodeClasses (`karpenter/classes.ts`) define the EC2-shape side: subnets via `karpenter.sh/discovery=<clusterName>` + `Purpose` tag, gp3 disks (60Gi for workload, 15Gi for ingress and system), Bottlerocket ARM/x86 AMI alias, IMDSv2 with IPv6 support.

The Karpenter controller itself runs on system nodes with `karpenter.sh/do-not-disrupt: "true"` and a `DoNotSchedule` topologySpreadConstraint on `karpenter.sh/capacity-type` — exactly one of the two replicas on each capacity type, so a spot drought cannot take down both controllers simultaneously.

### 1.5 Storage (`storage/`)

- **EBS CSI** — AWS-managed addon, IRSA with `AmazonEBSCSIDriverPolicy`. `ebs-gp3` StorageClass is the default; `ebs-gp2` / `ebs-gp2-imm` only if `enableGP2Storage: true`. VolumeSnapshotClasses `ebs` (delete) and `ebs-retain`.
- **S3 CSI** — only deployed if `s3buckets` is set. Service account scoped to read/write those buckets. Used by data team for Dagster/reporting/translations buckets.
- **EFS CSI** — only if `enableEfsStorage: true`. AWS-managed addon, IRSA with `AmazonEFSCSIDriverPolicy`, one encrypted filesystem (elastic throughput, IA after 1 day, archive after 7), NFS/2049 from the node security group only, one mount target per workload subnet. StorageClass `efs`, `Immediate` binding, `efs-ap` provisioning chrooting each claim to `/${.PVC.namespace}/${.PVC.name}` with `ensureUniqueDirectory`. `enableEfsReclaim` takes two passes on a cluster that has never run the driver.

### 1.6 Load Balancer Controller (`loadbalancer/`)

Helm `aws-load-balancer-controller` v3.1.0 in `kube-system`. 2+ replicas, topology-spread across AZs, affinity prefers ingress nodes, tolerates spot. IRSA for managing ALBs/NLBs. Off when `enableAwsLb: false`.

### 1.7 cert-manager (`cert-manager/`)

cert-manager controller v1.20.0 in `cert-manager` ns, 2 replicas + PDB. Gateway API integration enabled (auto-cert for Gateway resources). Affinity to ingress nodes.

Public issuers (only when `enableCertManagerPublic: true`):

- **Let's Encrypt** ClusterIssuer with Route53 DNS-01 solver, email `tls-renewal@bes.au`.
- **ZeroSSL** ClusterIssuer (only when `zerosslEabKid`/`zerosslEabKey` are set).

### 1.8 external-dns (`externalDns.ts`)

v0.20.0, single replica (Recreate strategy to avoid TXT ownership races). IRSA with Route53 change rights. Sources: `service`, `ingress`, `gateway-httproute`. TXT registry owner ID `k8s-extdns-{clusterName}` so multiple clusters can share a zone safely.

Requires `externalDnsZones` map. In production:

```yaml
externalDnsZones:
  internal.tamanu.io: Z0565335834ZM6R45IL3
  ops.tamanu.io:      Z07118832KOZ96U06G6JA
  tamanu.io:          Z05012672E70S3FGQA4S8
  tamanu.app:         Z084154625CG4H1J31NQ9
  tama.nu:            Z07184902ZUVH7N7UFIUJ
```

### 1.9 Backups

- **AWS Backup** (`awsBackup.ts`) — vault `bes-k8s-{stack}-eks`, daily rule at 14:00 UTC, 7-day retention. Covers the EKS cluster resource itself (not data — data is handled by app-level backup jobs).
- **Kopia/application backup S3** (`backups.ts`) — bucket `bes-k8s-{stack}-backups`, service account `s3-backups` with IRSA usable from any namespace. The name exported as `backupsServiceAccountArn` is what app stacks bind to.

### 1.10 Versions (`versions.ts`)

| Component | Pin |
|---|---|
| cert-manager | `1.20.0` |
| aws-load-balancer-controller | `3.1.0` |
| external-dns | `0.20.0` |

### 1.11 Real stack configs

**`Pulumi.tamanu-internal-main.yaml`** — Kubernetes 1.33; `enableGP2Storage: true` (legacy PVCs still out there); `s3buckets` for the data team's buckets; `withLaunchTemplate: false`; ZeroSSL EAB creds as secrets.

**`Pulumi.data-internal-data.yaml`** — 1.34; `azLimit: 2`; `withLaunchTemplate: true`; only `data.bes.au` zone; `enableAwsLb: false`; `enableCertManagerPublic: false`; `enableExternalDns: false` (data cluster isn't publicly addressable).

---

## 2. k8s-essentials

### 2.1 Module wiring (`index.ts`)

After `failIfIncorrectCluster()`:

```
[optional]  envoy-gateway
            prometheus + opencost + metrics roles
            tailscale (operator deploys if config provides OAuth creds)
            team RBAC roles
[optional]  nginx ingress
[optional]  CloudNativePG
[optional]  PGRO (postgres restore)
[optional]  HNC (CRDs, roles, manager, webhooks)
```

### 2.2 Top-level knobs

Under the `k8s-essentials:` config namespace.

| Key | Default | Notes |
|---|---|---|
| `k8s-core` | **required** | Cross-stack ref to the k8s-core stack. |
| `nginxEnabled` | `true` | NGINX Ingress v4.15.1. Disable when using Envoy exclusively. |
| `postgresEnabled` | `true` | CNPG v0.27.1. |
| `postgresRestoreEnabled` | `false` | PGRO. CRDs must be applied separately first. |
| `hncEnabled` | `true` | HNC controller + webhooks. |
| `tailscaleClientId`, `tailscaleClientSecret` | — | Required to actually enrol the Tailscale operator. |
| `tailscaleProxyDefaultTags` | `[tag:k8s, tag:k8s-proxy]` | Tags applied to Tailscale-exposed service proxies. |
| `tailscaleOperatorDefaultTags` | `[tag:k8s-operator]` | Tags for the operator itself. |
| `tailscaleExitNodeName` | — | Optional: make the operator also a Tailscale exit node. |
| `pgro:imageTag` | — | Tag for the Postgres Restore Operator image (separate config scope). |

### 2.3 Envoy Gateway (`envoyGateway.ts`)

Namespace `envoy-gateway-system`. Controller: 2 replicas, affinity → system nodes. Managed proxy fleet: 2 replicas, affinity → ingress nodes, fronted by an NLB (dualstack, IPv6-primary, TCP_UDP listener so the same NLB serves HTTP/1.1, HTTP/2, and HTTP/3 over QUIC). NLB has deletion protection. `mergeGateways: true` — all Gateway resources share a single Envoy deployment and NLB.

A custom `ValidatingAdmissionPolicy` enforces: `ClientTrafficPolicy` must set `spec.http3` (required under mergeGateways), and proxy protocol must be disabled (breaks QUIC).

### 2.4 NGINX Ingress (`ingress.ts`)

v4.15.1, 2 replicas on ingress nodes, spot tolerations, NLB dualstack service. Brotli on, proxy-protocol real-IP, 50 MB max body, HTTP/2. Snippet annotations disabled (security).

### 2.5 Tailscale operator (`tailscale.ts`)

v1.94.2, ns `tailscale-system`. Runs on ingress nodes (public subnets → better routing). API server proxy mode on → you can reach the k8s API via Tailscale MagicDNS as `k8s-operator-{cluster}.tail53aef.ts.net`. That's how `kubectl` connects to the cluster in normal use; direct AWS-auth is only needed during bootstrap or recovery.

### 2.6 CloudNativePG (`postgres/cnpg.ts`)

v0.27.1, ns `cnpg-system`, system node affinity. Auto-fetches Postgres image catalogs (Bookworm base + optional PostGIS) from GitHub. Clusters aren't created here — applications declare `Cluster` resources in their own namespaces.

PGRO (Postgres Restore Operator) is a separate optional install; CRDs must be applied by hand first (`postgresRestoreEnabled: true` then re-run).

### 2.7 Metrics (`metrics/`)

- **Prometheus** v28.13.0 in `metrics-system`, single replica on a workload node, 50 Gi PVC, 1 CPU / 2 Gi request, 2 CPU / 5 Gi limit, cross-AZ anti-affinity.
- **OpenCost** v2.5.11, UI enabled, same namespace, same Prometheus. Reads the AWS Spot data feed bucket via the IRSA role exported from k8s-core (`opencostRoleArn`).

### 2.8 HNC (`hnc/`)

v1.1.0 (upstream project is archived; this is the terminal release). Manager Deployment is single-replica, webhooks Deployment is two replicas across zones. Ports 9443 (webhooks), 8080 (metrics), 8081 (health). `--max-reconciles=10`, `--apiserver-qps-throttle=50`, and `--nopropagation-label=cattle.io/creator=norman` (avoids fighting Rancher on inherited clusters).

Excluded from the hierarchy: `kube-system`, `kube-public`, `kube-node-lease`.

HNC is used heavily by `tamanu/on-k8s` for per-deployment namespace lifecycle (see the Tamanu-on-K8s doc). If you turn HNC off, don't expect that workflow to work.

#### Why HNC is built just-in-time

The upstream image at `gcr.io/k8s-staging-multitenancy/hnc-manager:v1.1.0` is amd64-only (single-arch manifest). The project is archived, so no multi-arch tag is ever coming. To avoid pinning an entire dedicated amd64 node pool just for HNC, the deployment uses a two-step pod:

1. An init container (`golang:1.21`) clones the v1.1.0 source from GitHub and runs `CGO_ENABLED=0 go build` for the node's native architecture, dropping the binary into a shared `emptyDir`.
2. The main container (`gcr.io/distroless/static:nonroot`, multi-arch) runs that binary.

This keeps the runtime container small and unprivileged, and lets HNC schedule on any system node. The cost is ~60–180 s of init time per pod cold-start (build runs natively under QEMU-free) plus the `golang:1.21` image pull on first use. HNC pods restart rarely, so this is amortised cheaply.

Caveats:
- Pod startup depends on `github.com` being reachable. If it isn't when a pod is rescheduled, the pod won't come up. We accept this dependency rather than maintain a fork.
- The HNC source is pure Go, no CGO, no asm, no `runtime.GOARCH` checks — verified by inspection. So no source patches are needed for arm64; the upstream image is amd64 purely because the upstream CI never emitted multi-arch tags.
- Long-term direction is to migrate off HNC entirely; see `hnc-to-kyverno-migration-plan.md`.

### 2.9 RBAC (`roles/`)

`oncall.ts` and `data-engineer.ts` — cluster RBAC for those teams, authenticated via Tailscale group claims.

### 2.10 Versions (`versions.ts`)

| Component | Pin |
|---|---|
| Envoy Gateway | `v1.7.1` |
| HNC | `1.1.0` |
| NGINX Ingress | `4.15.1` |
| OpenCost | `2.5.11` |
| Prometheus | `28.13.0` |
| CNPG | `0.27.1` |
| Tailscale operator | `1.94.2` |

(PGRO tag set via per-stack config.)

### 2.11 Real stack configs

**`Pulumi.tamanu-internal-main.yaml`** — full feature set: `hncEnabled: true`, Tailscale on (with `tailscaleExitNodeName: vpn-exit-sydney`), Envoy Gateway on. `kubernetes:cluster` pointing at the Tailscale MagicDNS hostname so Pulumi itself connects via Tailscale.

**`Pulumi.data-internal-data.yaml`** — `hncEnabled: false`, `nginxEnabled: false`, `postgresRestoreEnabled: true`, custom Tailscale tags (`tag:k8s-data-*`), `pgro:imageTag: 0.3.4`.

---

## 3. Bootstrapping a fresh cluster

Bootstrap is the only time `k8s-essentials` needs AWS access — to obtain initial Kubernetes API credentials directly from EKS before the Tailscale proxy exists. After bootstrap, `k8s-essentials` runs purely over Tailscale.

1. Deploy `k8s-core` (needs AWS creds — it provisions the cluster). See §3.1 below for the seed-node step required once managed nodegroups are gone.
2. Get interim cluster access via EKS auth:
   ```
   aws-sso exec -p <profile> -- aws eks update-kubeconfig --name <cluster-name>
   ```
   Then edit `~/.kube/config` to prefix the exec command with `aws-sso exec -p <profile> --`.
3. Deploy `k8s-essentials`. During the first pass, comment out the CNPG image catalogs in `postgres/cnpg.ts` until CNPG CRDs exist, then uncomment on the second pass.
4. Once the Tailscale operator is up, switch `~/.kube/config` to the Tailscale MagicDNS server URL (`k8s-operator-{cluster}.tail53aef.ts.net`). From this point on, every subsequent `k8s-essentials` Pulumi run and every `kubectl` call uses Tailscale; AWS creds aren't needed for anything other than updating `k8s-core`.

### 3.1 Karpenter seed-node bootstrap

After the Karpenter migration completes (Phase 7 — managed workload/ingress/system nodegroups deleted, Cluster Autoscaler removed), creating a fresh cluster runs into a chicken-and-egg: Karpenter's controller needs a node to run on, but no managed nodegroups exist to provide one, and Karpenter can't provision its own first node from nothing.

The fix is a one-shot "seed" node that exists only during initial cluster creation. Two paths:

**Option A — Temporary managed nodegroup (preferred).** A `bootstrap` config gate in `nodes/groups.ts` conditionally creates a single seed system nodegroup (1×t-class arm64 per AZ, 25 GiB disk). Default off; flip on for cluster creation, off after Karpenter is healthy.

1. Set `k8s-core:bootstrap: "true"` in the new stack's `Pulumi.<stack>.yaml`. Run `pulumi up`. Cluster is created plus one seed node per AZ.
2. Verify Karpenter is healthy: `kubectl -n kube-system get pod -l app.kubernetes.io/name=karpenter -o wide`, `kubectl get nodepools`, `kubectl get ec2nodeclasses`.
3. Wait for Karpenter to provision its first system node from `system-arm` NodePool, or force the migration: `kubectl drain <seed-node> --ignore-daemonsets --delete-emptydir-data`. The Karpenter controller (carrying `karpenter.sh/do-not-disrupt`) will reschedule onto a Karpenter-provisioned node.
4. Set `bootstrap: false` (or delete the key) and run `pulumi up` again. The seed nodegroup is destroyed; cluster is now fully on Karpenter.

The seed nodegroup is intentionally tiny (1 node per AZ, burstable instance type, 25 GiB disk) — it only needs to host the Karpenter controller long enough to bootstrap.

**Option B — Manual EC2 instance.** Launch a single instance directly (CLI/Console) with the cluster's `nodeRole` instance profile, in a workload subnet, with userdata matching the EKS bootstrap pattern (same Bottlerocket variant the managed nodegroups used). Wait for the node to join. Then proceed as Option A from step 2; terminate the instance manually once Karpenter has migrated. Use only if Pulumi isn't an option.

Day-to-day this isn't needed — there's always a Karpenter node alive. The seed-node procedure is for cluster creation only.

---

## 4. Connecting as a human

Normal day-to-day: use Tailscale.

```yaml
# ~/.kube/config
clusters:
- cluster:
    server: https://k8s-operator-tamanu-internal-main.tail53aef.ts.net
  name: k8s-operator-tamanu-internal-main.tail53aef.ts.net
contexts:
- context:
    cluster: k8s-operator-tamanu-internal-main.tail53aef.ts.net
    user: tailscale-auth
  name: k8s-operator-tamanu-internal-main.tail53aef.ts.net
current-context: k8s-operator-tamanu-internal-main.tail53aef.ts.net
users:
- name: tailscale-auth
  user:
    token: unused
```

Permissions come from your Tailscale ACL group membership. RBAC in `k8s-essentials/roles/` maps `tailscale:oncall` and `tailscale:data-engineer` to ClusterRoles.

---

## 5. What lives where, quick reference

| Concern | k8s-core | k8s-essentials |
|---|---|---|
| EKS control plane | ✓ | |
| Karpenter (controller, NodeClasses, NodePools) + bootstrap nodegroup | ✓ | |
| EBS/S3/EFS CSI, StorageClasses | ✓ | |
| AWS LB Controller | ✓ | |
| cert-manager + LE/ZeroSSL issuers | ✓ | |
| external-dns | ✓ | |
| OIDC / IRSA | ✓ | |
| Backup S3 bucket + SA | ✓ | |
| AWS Backup (cluster) | ✓ | |
| Ingress (NGINX) | | ✓ |
| Envoy Gateway | | ✓ |
| Tailscale operator | | ✓ |
| Prometheus + OpenCost | | ✓ |
| CloudNativePG, PGRO | | ✓ |
| HNC | | ✓ |
| Team RBAC | | ✓ |

Workloads on top of those layers are in their own Pulumi stacks — see `docs/tamanu-on-k8s.md` for Tamanu specifically.
