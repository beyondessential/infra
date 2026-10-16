# How to update Kubernetes clusters

Do these things in order.

This process takes roughly 1-2 hours, mostly waiting on addon and cluster-version upgrades. Node replacement happens passively in the background once Karpenter notices the new AMI alias.

Open Headlamp on the cluster view, and note the percentage of pods that are good.
That should be about 95% or above.
There's often a little failure, which is mostly application-level issues.
You want to remain within 5% of this number for the entire duration of the upgrade.
If it starts going haywire this is going to go down rather quickly and people are going to notice.

## Prep: in Pulumi

- [ ] **DO NOT** change the version in Pulumi
- [ ] Update the versions of controllers in k8s-core and k8s-essentials (e.g. external-dns, ingresses, Karpenter chart in `karpenter/controller.ts`, etc.)
- [ ] Fully apply `pulumi up` for the cluster for k8s-core and k8s-essentials

## Upgrade: in AWS console

EKS-managed addons (none of these are Karpenter-managed):

- [VPC CNI](https://docs.aws.amazon.com/eks/latest/userguide/managing-vpc-cni.html)
- [EBS CSI](https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/master/docs/install.md)
- [CoreDNS](https://docs.aws.amazon.com/eks/latest/userguide/managing-coredns.html#coredns-versions)
- [kube-proxy](https://docs.aws.amazon.com/eks/latest/userguide/managing-kube-proxy.html)

Process:

- [ ] Take a backup of the cluster. This will take an hour.
- [ ] Upgrade addons to the latest version compatible with the CURRENT Kubernetes version:
  - Process:
    1. Consult the versions table/requirement if available to match the addon version to the cluster version.
    2. Record the BACK VERSION of the existing addon
    3. Select the latest FRONT VERSION of the addon with a matching BACK VERSION of the EXISTING ADDON
    4. For example, if you're on version v1.19.3-eksbuild.1, you can only upgrade to v1.xx.y-eksbuild.1, _not_ to v1.xx.y-eksbuild.2
    5. Wait until the addon is fully upgraded. This will take some minutes, but you need to keep manually refreshing the AWS Console page, it doesn't update on its own.
- [ ] Upgrade the cluster version. This will take 10 minutes.
- [ ] Upgrade addons to the latest version compatible with the NEW Kubernetes version.

The Cluster info panel may show errors and warnings in the "upgrade insights" section.
Don't be alarmed! These are testing compatibility for the *next* version, not the one you just upgraded to.

## Nodes: Karpenter handles automatically

Once the cluster version is upgraded, EKS publishes a new compatible Bottlerocket AMI under the `bottlerocket@latest` alias that the EC2NodeClasses reference. Karpenter detects the drift (within minutes to an hour depending on its reconcile interval) and starts replacing nodes one at a time, respecting:

- Per-NodePool disruption budgets (default 10%; ingress capped at 1)
- PodDisruptionBudgets on workloads
- Spot interruption flow

You don't need to do anything here. Optionally monitor:

```
kubectl get nodeclaims -L karpenter.sh/nodepool --sort-by=.metadata.creationTimestamp
kubectl get events -A --field-selector reason=DisruptionTerminating
kubectl -n kube-system logs -l app.kubernetes.io/name=karpenter --tail=100 | rg -i 'drift|disrupt'
```

To force a faster roll, `kubectl drain <node>` individual nodes — Karpenter immediately provisions a replacement on the new AMI.

## Finalise: in Pulumi

- [ ] Change the kubernetes version in Pulumi
- [ ] Fully apply `pulumi up` for the cluster for k8s-core
- [ ] Commit and PR/push all of that
