# SOP: Update a Kubernetes cluster

Upgrades the Kubernetes version, the EKS add-ons and the shared components of a cluster, in this order.
Most of the time goes on waiting for add-on and cluster-version upgrades; nodes are replaced by Karpenter in the background once it notices the new AMI.
Placeholders: [what lives where](../reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages).
Versions and where they live: [k8s-component-versions](../reference/k8s-component-versions.md).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Every step that changes AWS or the cluster is **[dev-OTS]**, and a human runs it; an agent never initiates an AdminAccess run.

## 0. Baseline

Open Headlamp on the cluster view and note the percentage of healthy pods.
It is usually 95% or above; some failure is normally application-level.
Stay within 5% of that number for the whole upgrade: if it falls fast, stop and use [cluster-upgrade-stuck](../runbooks/cluster-upgrade-stuck.md). **[diagnose]**

## 1. Prepare in Pulumi

Do not change `k8s-core:version` yet.
The Cluster resource ignores that key, so it never upgrades AWS; the step at the end only records the new version.

1. Bump the controller versions that are due, in `pulumi/k8s-core/versions.ts`, `KARPENTER_VERSION` in `pulumi/k8s-core/karpenter/controller.ts`, and `pulumi/k8s-essentials/versions.ts` ([where each lives](../reference/k8s-component-versions.md)). **[dev-OTS]**
2. Component cautions:
   - Envoy Gateway: apply the matching Gateway API CRD bundle before raising either version. The preflight in k8s-essentials refuses to deploy otherwise ([runbook](../runbooks/envoy-gateway-crd-mismatch.md)).
   - HNC pods build their binary at start-up and need `github.com` reachable ([runbook](../runbooks/hnc-pods-not-starting.md)).
3. Apply `k8s-core` then `k8s-essentials`, fully. **[dev-OTS]**

   ```
   aws-sso exec -p <profile> -- pulumi up --policy-pack ../policies     # k8s-core
   pulumi up --policy-pack ../policies                                 # k8s-essentials, over the tailnet
   ```

   Preview each first with the policy pack (`npm run build` in `pulumi/policies` beforehand). **[diagnose]** An agent runs the preview with a `ReadAccess` profile only; the AdminAccess form is for a human, and an agent never initiates it.

## 2. Upgrade in the AWS console

The add-ons are EKS-managed, not Karpenter-managed: `vpc-cni`, `kube-proxy`, `coredns`, `aws-ebs-csi-driver`, `snapshot-controller`, `eks-node-monitoring-agent`, and `aws-efs-csi-driver` and `aws-mountpoint-s3-csi-driver` where enabled.

1. Take a backup of the cluster. The AWS Backup plan covers the EKS cluster resource (vault `bes-k8s-<cluster>-eks`) and takes about an hour. **[dev-OTS]**
2. Upgrade each add-on to the latest version compatible with the current Kubernetes version. **[dev-OTS]**
   1. Find the compatibility table or requirement for the add-on.
   2. Record the back version of the existing add-on (the `eksbuild` suffix, for example `v1.19.3-eksbuild.1`).
   3. Choose the latest front version that has a matching back version: from `v1.19.3-eksbuild.1` you can go to `v1.xx.y-eksbuild.1`, not `-eksbuild.2`.
   4. Wait until the upgrade finishes. The console does not refresh itself; reload it.
3. Upgrade the cluster version. **[dev-OTS]**
4. Upgrade the add-ons again, to the latest compatible with the new Kubernetes version. **[dev-OTS]**

The "upgrade insights" panel may list errors and warnings: they test compatibility with the next version, not the one you just installed.

## 3. Nodes roll by themselves

Once the cluster version is up, EKS publishes a compatible Bottlerocket AMI under `bottlerocket@latest`, which every EC2NodeClass names.
Karpenter sees the drift (minutes to an hour, by its reconcile interval) and replaces nodes one at a time, respecting:

- the node pool disruption budgets: Karpenter's default 10% on most pools, one at a time on `ingress-arm`, and one at a time within 14:00 to 16:00 UTC on `db-critical` ([pools](../reference/k8s-node-pools.md#node-pools));
- PodDisruptionBudgets;
- the spot interruption flow.

Nothing to do; to watch. **[diagnose]**

```
kubectl get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
kubectl get events -A --field-selector reason=DisruptionTerminating
kubectl -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=100 | rg -i 'drift|disrupt'
```

To speed it up, drain individual nodes with `kubectl drain <node>`; Karpenter provisions a replacement on the new AMI at once. **[dev-OTS]**
Do not drain a `db-critical` or `db-replica` node this way without a developer: draining taints it `karpenter.sh/disrupted`, which CloudNativePG answers with a switchover before the primary is evicted.

## 4. Finalise in Pulumi

1. Set the new version in the `k8s-core` stack config: `pulumi config set k8s-core:version "<version>"`. **[dev-OTS]**
2. Apply `k8s-core` fully. **[dev-OTS]**
3. Commit and open a pull request for the version bumps in code. The stack config is gitignored and lives in the Pulumi backend.
