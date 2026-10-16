---
id: GRD
---

# Pulumi guardrails

The requirements in this spec apply to the policy pack named `bes-guardrails` and to the previews and updates of Pulumi stacks that run with it.

## Borrowed terms

| term | meaning |
|---|---|
| policy pack | A set of policies that the Pulumi engine evaluates during a preview or update ([Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/)). |
| resource validation policy | A policy evaluated against each resource as the stack registers it ([Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/)). |
| stack validation policy | A policy evaluated once against every resource of the stack after all have been registered ([Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/)). |
| mandatory | The enforcement level at which a violation fails the preview or update ([Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/)). |
| violation | A policy's report that a resource does not satisfy it ([Pulumi policy as code](https://www.pulumi.com/docs/iac/crossguard/core-concepts/)). |
| URN | The unique name of a resource, of the form `urn:pulumi:<stack>::<project>::<type>::<name>` ([Pulumi resource names](https://www.pulumi.com/docs/iac/concepts/resources/names/)). |
| project | The Pulumi project that declares a stack, the second segment of the URN of each of its resources ([Pulumi resource names](https://www.pulumi.com/docs/iac/concepts/resources/names/)). |
| claim | A PersistentVolumeClaim, a workload's request for storage ([Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)). |
| access mode | A member of the `accessModes` of a claim, such as `ReadWriteOnce`, `ReadWriteOncePod` or `ReadWriteMany`, stating how many nodes may mount the volume and with what permission ([Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)). |
| storage class | A named class of storage that claims select ([Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)). |
| deployment strategy | The `spec.strategy.type` of a Deployment, `RollingUpdate` by default or `Recreate` ([Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)). |
| access point | An application-specific entry into an Amazon EFS filesystem that fixes the directory a client sees as its root ([Amazon EFS access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html)). |
| `subPathPattern`, `ensureUniqueDirectory`, `provisioningMode` | Parameters of a storage class served by the EFS CSI driver ([EFS CSI driver parameters](https://github.com/kubernetes-sigs/aws-efs-csi-driver/blob/master/docs/parameters.md)). |
| delegated administrator | The member account that manages GuardDuty for an AWS organisation ([GuardDuty and AWS Organizations](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_organizations.html)). |

## Rule set

The pack MUST contain the rules in the following table.

| rule | subject | kind | section |
|---|---|---|---|
| `guardduty-single-owner` | Resources of the GuardDuty provider module. | Resource validation policy. | [GuardDuty ownership](#guardduty-ownership) |
| `deployment-pvc-needs-recreate` | Deployments that mount a claim. | Stack validation policy. | [Deployment rollout strategy](#deployment-rollout-strategy) |
| `efs-access-point-scoped` | EFS storage classes and EFS persistent volumes. | Stack validation policy. | [EFS access point scope](#efs-access-point-scope) |

Every rule MUST be mandatory.

A violation MUST fail the preview or update that reports it.

A violation report MUST name the rule and the resource that violates it.

A violation report MUST state why the resource violates the rule.

A rule MUST NOT report a resource outside its subject.

A rule MUST judge a resource from the declarations of the one stack being previewed or updated.

The pack MUST apply to a stack of any project without per-stack configuration.

## Application to stacks

An operator SHOULD run every preview of a Pulumi stack with the pack.

An operator SHOULD run every update of a Pulumi stack with the pack.

Automation that previews or updates stacks SHOULD run each of them with the pack.

A preview or update that is meant to enforce the current rules SHOULD run against a build of the pack made from the current source.

> [!NOTE]
> The engine loads the pack from its build output.
> A build older than the source enforces the rules it was built from, and reports nothing about the rules added since.

## GuardDuty ownership

The pack MUST reject a resource whose type token begins `aws:guardduty/` where the project that declares it is not `security-monitoring`.

The pack MUST reject a resource whose type token begins `aws:guardduty/` where the project cannot be read from its URN.

The pack MUST accept a resource whose type token begins `aws:guardduty/` where the project that declares it is `security-monitoring`.

The pack MUST NOT report a resource whose type token does not begin `aws:guardduty/`, whatever project declares it.

A violation report MUST name the type of the resource, the project that declares it, and the project that owns GuardDuty resources.

> [!NOTE]
> The delegated administrator, the detector and the organisation configuration are singletons per region, and Pulumi does not check ownership across stacks.
> A second stack that declares them shares them silently, and destroying either stack disassociates every member account.

## Deployment rollout strategy

A Deployment that mounts a constrained claim MUST set its deployment strategy to `Recreate`.

The pack MUST reject a Deployment that mounts a constrained claim and whose deployment strategy is anything other than `Recreate`, including a Deployment that sets no strategy.

A Deployment mounts a claim where a volume of its pod template references the claim by name.

A claim is constrained or exempt according to the following table.

| claim | treatment |
|---|---|
| Declared in the stack, with access modes that include neither `ReadWriteOnce` nor `ReadWriteOncePod`. | Exempt. |
| Declared in the stack, with access modes that include `ReadWriteOnce` or `ReadWriteOncePod`. | Constrained. |
| Declared in the stack, with no access modes. | Constrained. |
| Not declared in the stack. | Constrained. |

The pack MUST NOT reject a Deployment that mounts no claim, or that mounts only exempt claims, whatever its deployment strategy.

A violation report MUST name each constrained claim that the Deployment mounts, and the deployment strategy in effect, giving `RollingUpdate` as the strategy of a Deployment that sets none.

> [!NOTE]
> A rolling update starts the replacement pod before it stops the old one.
> A volume that attaches to one node at a time leaves the replacement waiting on an attachment the old pod still holds, and the rollout hangs.
> A claim declared outside the stack is treated as constrained because its access modes cannot be read.

## EFS access point scope

The confinement and reclaim of shared filesystem content are specified in [K8SVOL](../kubernetes/volumes.md#isolation) and [K8SVOL](../kubernetes/volumes.md#reclaim).

The pack MUST reject a storage class whose provisioner is `efs.csi.aws.com` unless it meets every row of the following table.

| parameter | required |
|---|---|
| `provisioningMode` | `efs-ap`. |
| `subPathPattern` | Set, with at least two non-empty path segments, and referencing the claim name through `.PVC.name`. |
| `ensureUniqueDirectory` | `true`. |

The pack MUST report each unmet row of that table, and each unmet requirement within the `subPathPattern` row, as its own violation.

The pack MUST reject a PersistentVolume whose CSI driver is `efs.csi.aws.com` unless its volume handle is of the form `fs-<id>::fsap-<id>`, where each `<id>` is a non-empty string of lowercase hexadecimal digits.

The pack MUST reject a PersistentVolume whose CSI driver is `efs.csi.aws.com` and that has no volume handle.

The pack MUST NOT report a storage class or PersistentVolume that names any other provisioner or CSI driver.

> [!NOTE]
> The driver deletes the root directory of an access point when it releases a claim.
> A subpath that two claims share, or that sits at the filesystem root, puts the content of other claims within that deletion.
> A volume handle that names the filesystem and no access point reaches the whole filesystem.
> Without a unique directory, a rebuilt claim adopts the directory its predecessor left behind.

## Build and tests

Continuous integration MUST build the pack and run its tests for every change to the pack.

A change that leaves the pack unable to build, or its tests failing, MUST NOT be accepted.

Each rule SHOULD have tests that accept a compliant resource, reject each violation the rule defines, and ignore resources outside its subject.

> [!NOTE]
> A pack that fails to build leaves the stacks it guards unchecked, or checked against an older build.
