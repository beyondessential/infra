import * as k8s from '@pulumi/kubernetes';
import { eksServiceAccount } from '../common/eksServiceAccount.js';
import { addAddon, oidcProvider } from './cluster.js';
import { provider } from './kubeconfig.js';

const ebsRole = eksServiceAccount('eks-ebs-csi', {
  serviceAccountName: 'ebs-csi-controller-sa',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy'],
});

const addon = addAddon('aws-ebs-csi-driver', {
  purpose: 'system',
  serviceAccountRoleArn: ebsRole.arn,
  resolveConflicts: 'PRESERVE',
});

new k8s.storage.v1.StorageClass(
  'ebs-gp2',
  {
    provisioner: 'ebs.csi.aws.com',
    metadata: {
      name: 'ebs-gp2',
      annotations: {
        'storageclass.kubernetes.io/is-default-class': 'true',
      },
    },
    parameters: {
      type: 'gp2',
      'csi.storage.k8s.io/fstype': 'ext4',
    },
    allowVolumeExpansion: true,
    volumeBindingMode: 'WaitForFirstConsumer',
  },
  { dependsOn: addon, provider },
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
  { dependsOn: addon, provider },
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
  { dependsOn: addon, provider },
);

// TODO: https://github.com/kubernetes-csi/external-snapshotter/tree/master/client/config/crd
// then reinstall the csi plugin?
