import * as k8s from '@pulumi/kubernetes';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { addAddon, oidcProvider } from '../cluster.ts';
import { provider } from '../kubeconfig.ts';

const ebsRole = eksServiceAccount('eks-ebs-csi', {
  serviceAccountName: 'ebs-csi-controller-sa',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy'],
});

const addonStorage = addAddon('aws-ebs-csi-driver', {
  purpose: 'system',
  serviceAccountRoleArn: ebsRole.arn,
  resolveConflicts: 'PRESERVE',
});

const addonSnapshot = addAddon('snapshot-controller', {
  purpose: 'system',
  resolveConflicts: 'PRESERVE',
});

new k8s.storage.v1.StorageClass(
  'ebs-gp2',
  {
    provisioner: 'ebs.csi.aws.com',
    metadata: {
      name: 'ebs-gp2',
    },
    parameters: {
      type: 'gp2',
      'csi.storage.k8s.io/fstype': 'ext4',
    },
    allowVolumeExpansion: true,
    volumeBindingMode: 'WaitForFirstConsumer',
  },
  { dependsOn: addonStorage, provider },
);

new k8s.storage.v1.StorageClass(
  'ebs-gp2-imm',
  {
    provisioner: 'ebs.csi.aws.com',
    metadata: {
      name: 'ebs-gp2-imm',
    },
    parameters: {
      type: 'gp2',
      'csi.storage.k8s.io/fstype': 'ext4',
    },
    allowVolumeExpansion: true,
    volumeBindingMode: 'Immediate',
  },
  { dependsOn: addonStorage, provider },
);

new k8s.storage.v1.StorageClass(
  'ebs-gp3',
  {
    provisioner: 'ebs.csi.aws.com',
    metadata: {
      name: 'ebs-gp3',
      annotations: {
        'storageclass.kubernetes.io/is-default-class': 'true',
      },
    },
    parameters: {
      type: 'gp3',
      'csi.storage.k8s.io/fstype': 'ext4',
    },
    allowVolumeExpansion: true,
    volumeBindingMode: 'WaitForFirstConsumer',
  },
  { dependsOn: addonStorage, provider },
);

new k8s.apiextensions.CustomResource(
  'snapshot-ebs',
  {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshotClass',
    metadata: {
      name: 'ebs',
    },
    driver: 'ebs.csi.aws.com',
    deletionPolicy: 'Delete',
  },
  { dependsOn: addonSnapshot, provider },
);

new k8s.apiextensions.CustomResource(
  'snapshot-ebs-retain',
  {
    apiVersion: 'snapshot.storage.k8s.io/v1',
    kind: 'VolumeSnapshotClass',
    metadata: {
      name: 'ebs-retain',
    },
    driver: 'ebs.csi.aws.com',
    deletionPolicy: 'Retain',
  },
  { dependsOn: addonSnapshot, provider },
);

// TODO: https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/master/docs/snapshot.md#fast-snapshot-restores
