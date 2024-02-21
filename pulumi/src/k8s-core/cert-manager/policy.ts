import { interpolate } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { eksServiceAccount } from '../../common/eksServiceAccount.js';
import { clusterName, oidcProvider } from '../cluster.js';
import { provider } from '../kubeconfig.js';
import { namespace } from './namespace.js';
import { externalDnsZoneIds } from '../externalDns.js';

const SERVICE_ACCOUNT_NAME = 'awslbc';

const policy = new awsClassic.iam.Policy('certmanager-policy', {
  namePrefix: 'EKSCertManager-',
  description: interpolate`Policy for EKS cert-manager (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['route53:GetChange'],
        Resource: ['arn:aws:route53:::change/*'],
      },
      {
        Effect: 'Allow',
        Action: ['route53:ListHostedZonesByName'],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: ['route53:ChangeResourceRecordSets'],
        Resource: externalDnsZoneIds.map(
          (zone) => `arn:aws:route53:::hostedzone/${zone}`,
        ),
      },
    ],
  },
});

const role = eksServiceAccount('certmanager-role', {
  roleName: 'EKSCertManager-',
  roleDescription: interpolate`Service account for EKS cert-manager (cluster: ${clusterName})`,
  serviceAccountName: SERVICE_ACCOUNT_NAME,
  oidcProviderArn: oidcProvider.arn,
  namespace,
  managedPolicyArns: [policy.arn],
});

export const sa = new k8s.core.v1.ServiceAccount(
  'cert-manager-sa',
  {
    metadata: {
      name: SERVICE_ACCOUNT_NAME,
      namespace,
      annotations: {
        'eks.amazonaws.com/role-arn': role.arn,
      },
    },
  },
  { provider },
);
