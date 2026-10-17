# Support pack

This directory is the support pack for BES infrastructure: the material an on-call engineer, or an agent assisting one, reads when troubleshooting or operating a deployment. What each part of the system must do is in [the specifications](spec/overview.md). The pack says how to find out what is wrong and what to do about it, and cites the spec or the code for each claim.

Read the source when you need to. These documents are a starting point, and where they disagree with the code the code is right. Prefer a fact checked against the code to an assumption.

## Structure

- **Runbook** (`runbooks/`): one per named symptom. It walks the symptom from first report through confirming, interpreting, fixing and escalating.
- **SOP** (`sops/`): one reusable procedure that many runbooks refer to, such as connecting to a cluster or waking a deployment.
- **Reference** (`reference/`): lookup material with no procedure, such as config keys, object names and version pins.
- **Specifications** (`spec/`): what the system must do, in the voice of a standard. Start at [the overview](spec/overview.md).
- **Developer orientation** (`dev/`): how `pulumi/` is laid out and the conventions every stack follows.
- **Plans** (`plans/`): work in progress and migrations that the specs do not yet describe.

Two documents sit beside them: [deployment context](deployment-context.md), for working out which deployment is affected, and [ruled-out actions](ruled-out-actions.md), the hard filter on what may be suggested.

## The action-classification ladder

Every suggested action in a runbook or SOP is tagged with one of these classes, which rank how much oversight an action needs before anyone runs it.

- **diagnose**: read-only inspection, such as reading a log or checking a status. No mutation. Suggest freely.
- **approved-mitigation**: mutating, but a human has assessed it as low risk, or a runbook pre-signs it. Run it without anyone watching.
- **any-OTS**: mutating. Needs a second pair of eyes, and another support engineer suffices.
- **dev-OTS**: mutating. Needs a developer watching.
- **ruled-out**: destructive, irreversible or out of scope. Never suggested. Escalate instead. See [ruled-out actions](ruled-out-actions.md).

Anything mutating is **dev-OTS** until a human has assessed it lower. A runbook may pre-sign a specific step to a lower class, and outside that the default stands.

An action may also carry a **sensitive-data** flag. It marks actions that touch personal or credential data even when they only read, such as copying a log off a server. See the sensitive-data section of [ruled-out actions](ruled-out-actions.md).

## Load by convention

Tooling and agents recognise a support pack by `docs/ruled-out-actions.md` together with `docs/runbooks/`. When both exist the pack is loaded, and `ruled-out-actions.md` is a hard filter on any suggested action.

## Runbooks

- [Runbook: Application stays OutOfSync after a successful sync](runbooks/application-out-of-sync.md)
- [Runbook: Application stuck Progressing, or `pulumi up` times out](runbooks/application-stuck-progressing.md)
- [Runbook: `pulumi up` fails with "Argo CD sync Failed"](runbooks/argo-sync-failed.md)
- [Runbook: Canopy is not issuing certificates](runbooks/canopy-tls-not-issuing.md)
- [Runbook: Cannot reach the cluster API, or a stack refuses to run](runbooks/cluster-api-unreachable.md)
- [Runbook: A cluster upgrade is stuck or pod health is falling](runbooks/cluster-upgrade-stuck.md)
- [Runbook: a config or template change did not reach a deployment](runbooks/config-change-not-applied.md)
- [Runbook: a database does not come up](runbooks/database-not-coming-up.md)
- [Runbook: deployment is down but nothing failed](runbooks/deployment-down-nothing-failed.md)
- [Runbook: Envoy Gateway will not deploy or crash-loops after a version bump](runbooks/envoy-gateway-crd-mismatch.md)
- [Runbook: HNC pods not starting, or writes rejected by HNC webhooks](runbooks/hnc-pods-not-starting.md)
- [Runbook: a migrator or other hook Job failed](runbooks/hook-job-failed.md)
- [Runbook: pods stuck in ImagePullBackOff (image tag missing)](runbooks/image-pull-backoff.md)
- [Runbook: Karpenter NodeClasses not Ready](runbooks/karpenter-nodeclass-not-ready.md)
- [Runbook: a Linux server's backup is failing or missing](runbooks/linux-backup-failing.md)
- [Runbook: a Linux server's certificate is wrong or missing](runbooks/linux-certificate-not-served.md)
- [Runbook: a clone deployment's facility does not sync after a restore](runbooks/linux-clone-not-syncing.md)
- [Runbook: Tamanu cannot reach the database on a Linux server](runbooks/linux-database-not-reachable.md)
- [Runbook: a Linux server is running out of disk](runbooks/linux-disk-pressure.md)
- [Runbook: a Linux playbook refuses to run or stops early](runbooks/linux-playbook-refused.md)
- [Runbook: PostgreSQL restart pending on a production server](runbooks/linux-postgres-restart-pending.md)
- [Runbook: a Linux server cannot be reached](runbooks/linux-server-unreachable.md)
- [Runbook: a Tamanu service is down on a Linux server](runbooks/linux-tamanu-service-down.md)
- [Runbook: Pods stay Pending and no node appears](runbooks/nodes-not-provisioning.md)
- [Runbook: Application shows a render error](runbooks/render-error.md)
- [Runbook: a renderer change does not show up](runbooks/renderer-change-not-showing.md)
- [Runbook: a seeded deployment starts empty, with the wrong data, or refuses](runbooks/seeded-deployment.md)
- [Runbook: the update is refused before anything changes](runbooks/stub-refuses-update.md)
- [Runbook: teardown is stuck](runbooks/teardown-stuck.md)

## SOPs

- [SOP: Bootstrap a new Kubernetes cluster](sops/bootstrap-k8s-cluster.md)
- [SOP: Change a deployment's config and update it](sops/change-deployment-config.md)
- [SOP: Connect to a deployment's database from the cluster](sops/connect-database.md)
- [SOP: Connect to a cluster with kubectl](sops/connect-to-k8s-cluster.md)
- [SOP: Create a deployment](sops/create-deployment.md)
- [SOP: Destroy a deployment](sops/destroy-deployment.md)
- [SOP: Edit or reset the config ConfigMaps](sops/edit-or-reset-config.md)
- [SOP: Let Canopy issue certificates in another account's zone](sops/enable-canopy-tls-core.md)
- [SOP: Hard-refresh an Application](sops/hard-refresh-application.md)
- [SOP: Inspect an Application](sops/inspect-application.md)
- [SOP: Inspect the render](sops/inspect-render.md)
- [SOP: Check that a Linux server's backups are working](sops/linux-check-backups.md)
- [SOP: Check exposure to the blocked kernel modules](sops/linux-check-kernel-modules.md)
- [SOP: Convert a Linux server's disk layout](sops/linux-convert-disk-layout.md)
- [SOP: Provision a Linux Tamanu server](sops/linux-provision-server.md)
- [SOP: Restart PostgreSQL on a Linux server](sops/linux-restart-postgres.md)
- [SOP: Restore a Linux server from backup](sops/linux-restore-from-backup.md)
- [SOP: Retire a Linux deployment](sops/linux-retire-deployment.md)
- [SOP: Credentials on a Linux server](sops/linux-rotate-credentials.md)
- [SOP: Run the Linux playbooks](sops/linux-run-playbooks.md)
- [SOP: Upgrade PostgreSQL on a Linux server](sops/linux-upgrade-postgres.md)
- [SOP: Upgrade Tamanu on Linux servers](sops/linux-upgrade-tamanu.md)
- [SOP: Promote a renderer channel](sops/promote-renderer-channel.md)
- [SOP: Read logs](sops/read-logs.md)
- [SOP: Pull stack config to your machine](sops/refresh-stack-config.md)
- [SOP: Register a cluster's tags and operator identity in Tailscale](sops/register-cluster-in-tailscale.md)
- [SOP: Restart services](sops/restart-services.md)
- [SOP: Wind down or recall the bootstrap nodegroups](sops/scale-bootstrap-nodegroups.md)
- [SOP: Update a Kubernetes cluster](sops/update-k8s-cluster.md)
- [SOP: Wake a hibernated deployment](sops/wake-deployment.md)

## Reference

- [Reference: Canopy TLS issuance plumbing](reference/canopy-tls-config.md)
- [Reference: pinned component versions](reference/k8s-component-versions.md)
- [Reference: k8s-core stack config](reference/k8s-core-config.md)
- [Reference: k8s-essentials stack config](reference/k8s-essentials-config.md)
- [Reference: the `tamanu/k8s-infra` stack](reference/k8s-infra-stack.md)
- [Reference: node pools and node classes](reference/k8s-node-pools.md)
- [Reference: what lives where on a cluster](reference/k8s-what-lives-where.md)
- [Reference: Linux inventory](reference/linux-inventory.md)
- [Reference: Linux server paths, units and ports](reference/linux-paths-and-units.md)
- [Reference: Linux deployment stack config and outputs](reference/linux-pulumi-config.md)
- [Reference: Linux playbooks and roles](reference/linux-roles.md)
- [Reference: Linux playbook variables](reference/linux-variables.md)
- [PostgreSQL physical backups: why restores were dirty](reference/postgres-physical-backup-diagnosis.md)
- [Reference: Tamanu deployment stack config](reference/tamanu-deployment-config.md)
- [Reference: objects of a Tamanu deployment](reference/tamanu-deployment-objects.md)
