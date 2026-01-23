import { interpolate } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { $network } from '../../common/coreRef.ts';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { clusterName, oidcProvider } from '../cluster.ts';
import { provider } from '../kubeconfig.ts';
import { awsLbPolicy } from './policy.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';

const SERVICE_ACCOUNT_NAME = 'awslbc';

const policy = new awsClassic.iam.Policy('lbc-policy', {
  namePrefix: 'EKSLoadBalancerController-',
  description: interpolate`Policy for AWS EKS Load Balancer Controller (cluster: ${clusterName})`,
  policy: awsLbPolicy($network.vpc),
});

const role = eksServiceAccount('lbc-role', {
  roleName: 'EKSLoadBalancerController-',
  roleDescription: interpolate`Service account for AWS EKS Load Balancer Controller (cluster: ${clusterName})`,
  serviceAccountName: SERVICE_ACCOUNT_NAME,
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: [policy.arn],
});

const sa = new k8s.core.v1.ServiceAccount(
  'lbc-sa',
  {
    metadata: {
      name: SERVICE_ACCOUNT_NAME,
      namespace: 'kube-system',
      annotations: {
        'eks.amazonaws.com/role-arn': role.arn,
      },
    },
  },
  { provider },
);

new k8s.helm.v3.Release(
  'lbc',
  {
    chart: 'aws-load-balancer-controller',
    version: '1.17.1',
    repositoryOpts: {
      repo: 'https://aws.github.io/eks-charts',
    },
    namespace: 'kube-system',
    values: {
      clusterName,
      serviceAccount: {
        create: false,
        name: SERVICE_ACCOUNT_NAME,
      },
      tolerations: [CAN_RUN_ON_SPOT],
      affinity: {
        nodeAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 1,
              preference: RUN_ON_SPOT,
            },
          ],
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [purposeAffinity('ingress')],
              },
            ],
          },
        },
        podAntiAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: [
            {
              labelSelector: {
                matchExpressions: [
                  {
                    key: 'app.kubernetes.io/name',
                    operator: 'In',
                    values: ['aws-load-balancer-controller'],
                  },
                ],
              },
              topologyKey: 'topology.kubernetes.io/zone',
            },
          ],
        },
      },
    },
  },
  {
    provider,
    dependsOn: [sa],
    // otherwise it updates on every up, it's annoying
    ignoreChanges: ['checksum'],
  },
);
