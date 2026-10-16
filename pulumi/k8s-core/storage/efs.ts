import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { interpolate, jsonStringify, log } from '@pulumi/pulumi';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { addAddon, cluster, clusterName, oidcProvider, tags } from '../cluster.ts';
import { provider } from '../kubeconfig.ts';
import { $network, cfg } from '../../common/coreRef.ts';
import { withBootstrap } from '../nodes/groups.ts';

const NFS_PORT = 2049;

const efsRole = eksServiceAccount('eks-efs-csi', {
  serviceAccountName: 'efs-csi-controller-sa',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy'],
});

// spec: K8SVOL#reclaim
// Deletes a released claim's content along with its access point, so a cluster
// of short-lived deployments does not accumulate directories nothing can reach.
// Per-cluster and off by default because the driver deletes whatever root a
// departing access point names: safe only where every access point is confined
// to one claim's own directory, which the storage class below arranges and the
// `efs-access-point-scoped` guardrail holds it to.
const reclaimOnRelease = cfg.getBoolean('enableEfsReclaim') ?? false;

const addonEfs = addAddon(
  'aws-efs-csi-driver',
  {
    purpose: 'system',
    serviceAccountRoleArn: efsRole.arn,
    // The declared configuration has to win. Under PRESERVE a value already on
    // the cluster keeps the field, so reclaim would read as on here while the
    // controller ran without it.
    resolveConflicts: 'OVERWRITE',
    ...(reclaimOnRelease
      ? {
          configurationValues: jsonStringify({
            controller: { deleteAccessPointRootDir: true },
          }),
        }
      : {}),
  },
  { dependsOn: withBootstrap() },
);

// spec: K8SVOL#reclaim
// The addon takes a key its schema does not carry and drops it rather than
// refusing it, so the request is no evidence: what the controller was started
// with is. Read that back instead of trusting the config.
// Enabling reclaim on a cluster that has never run the driver takes two passes,
// since the controller has to exist before it can be read.
if (reclaimOnRelease) {
  k8s.apps.v1.Deployment.get('efs-csi-controller', 'kube-system/efs-csi-controller', {
    provider,
    dependsOn: addonEfs,
  })
    .spec.template.spec.containers.apply((containers) => {
      const honoured = containers.some((container) =>
        (container.args ?? []).includes('--delete-access-point-root-dir=true'),
      );
      if (!honoured) {
        log.warn(
          'enableEfsReclaim is set but efs-csi-controller is not running with ' +
            '--delete-access-point-root-dir=true: released claims will leave their content behind',
        );
      }
      return honoured;
    });
}

// spec: K8SVOL#protection
const filesystem = new awsClassic.efs.FileSystem('efs-shared', {
  encrypted: true,
  // Elastic bills throughput per request, which suits a store that is idle
  // between uploads rather than serving a steady rate.
  throughputMode: 'elastic',
  // Blobs are written once and read seldom. No transition back to standard on
  // access: the integrity scrub re-reads the whole store every few days to verify
  // hashes, which would bounce all of it back continuously and leave the tiering
  // doing nothing.
  lifecyclePolicies: [
    { transitionToIa: 'AFTER_1_DAY' },
    { transitionToArchive: 'AFTER_7_DAYS' },
  ],
  tags: {
    Purpose: 'k8s-shared-storage',
    ...tags,
  },
});

// spec: K8SVOL#protection
const securityGroup = new awsClassic.ec2.SecurityGroup(
  'efs-shared',
  {
    vpcId: $network.vpc,
    description: interpolate`Shared filesystem (cluster: ${clusterName})`,
    ingress: [
      {
        description: 'NFS from cluster nodes',
        fromPort: NFS_PORT,
        toPort: NFS_PORT,
        protocol: 'tcp',
        securityGroups: [cluster.clusterSecurityGroupId],
      },
    ],
    tags: {
      Purpose: 'k8s-shared-storage',
      ...tags,
    },
  },
  { parent: filesystem },
);

// spec: K8SVOL#multi-node-access
// One mount target per AZ is the EFS limit, and the workload subnets are one
// per zone. A zone without one has no route to the filesystem.
$network.workloadSubnetIds.apply((subnetIds) =>
  subnetIds.map(
    (subnetId, az0) =>
      new awsClassic.efs.MountTarget(
        `efs-shared-${az0}`,
        {
          fileSystemId: filesystem.id,
          subnetId,
          securityGroups: [securityGroup.id],
        },
        { parent: filesystem },
      ),
  ),
);

// spec: K8SVOL#multi-node-access
// spec: K8SVOL#isolation
new k8s.storage.v1.StorageClass(
  'efs',
  {
    provisioner: 'efs.csi.aws.com',
    metadata: {
      name: 'efs',
    },
    parameters: {
      // efs-ap chroots each claim to its own directory via an access point.
      provisioningMode: 'efs-ap',
      fileSystemId: filesystem.id,
      directoryPerms: '700',
      subPathPattern: '/${.PVC.namespace}/${.PVC.name}',
      // A rebuilt deployment reuses its namespace and claim names, so without
      // this it would adopt the directory its predecessor left behind.
      ensureUniqueDirectory: 'true',
    },
    volumeBindingMode: 'Immediate',
  },
  { dependsOn: addonEfs, provider },
);
