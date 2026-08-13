import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { interpolate, jsonStringify } from '@pulumi/pulumi';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { addAddon, cluster, clusterName, oidcProvider, tags } from '../cluster.ts';
import { provider } from '../kubeconfig.ts';
import { $network } from '../../common/coreRef.ts';
import { withBootstrap } from '../nodes/groups.ts';

const NFS_PORT = 2049;

const efsRole = eksServiceAccount('eks-efs-csi', {
  serviceAccountName: 'efs-csi-controller-sa',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy'],
});

// k[volumes.shared-reclaim]
// Releasing a claim has to take its bytes with it. Every access point owns a
// directory no other claim can be given, so deleting the directory with the
// access point cannot reach content that is still claimed.
const addonEfs = addAddon(
  'aws-efs-csi-driver',
  {
    purpose: 'system',
    serviceAccountRoleArn: efsRole.arn,
    resolveConflicts: 'PRESERVE',
    configurationValues: jsonStringify({
      controller: { deleteAccessPointRootDir: true },
    }),
  },
  { dependsOn: withBootstrap() },
);

// k[volumes.shared-encryption]
const filesystem = new awsClassic.efs.FileSystem('efs-shared', {
  encrypted: true,
  // Elastic bills throughput per request, which suits a store that is idle
  // between uploads rather than serving a steady rate.
  throughputMode: 'elastic',
  // Blobs are written once and read seldom. A read pulls its file back to
  // standard, so this mostly prices down content nothing reads any more.
  lifecyclePolicies: [
    { transitionToIa: 'AFTER_30_DAYS' },
    { transitionToPrimaryStorageClass: 'AFTER_1_ACCESS' },
    { transitionToArchive: 'AFTER_90_DAYS' },
  ],
  tags: {
    Purpose: 'k8s-shared-storage',
    ...tags,
  },
});

// k[volumes.shared-network-confinement+2]
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

// k[volumes.shared-zone-reach]
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

// k[volumes.shared-multi-node+3] k[volumes.shared-isolation+2]
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
