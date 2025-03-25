import { interpolate } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { eksServiceAccount } from '../common/eksServiceAccount.js';
import { clusterName, oidcProvider } from './cluster.js';
import { provider } from './kubeconfig.js';
import { cfg } from '../common/coreRef.js';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.js';

const externalDnsZones: { [domain: string]: string } = cfg.requireObject('externalDnsZones');
export const externalDnsZoneDomains = Object.keys(externalDnsZones);
export const externalDnsZoneIds = Object.values(externalDnsZones);

const policy = new awsClassic.iam.Policy('extdns-policy', {
  namePrefix: 'EKSExternalDNS-',
  description: interpolate`Policy for EKS External DNS (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['route53:ChangeResourceRecordSets'],
        Resource: externalDnsZoneIds.map(
          (zone) => `arn:aws:route53:::hostedzone/${zone}`,
        ),
      },
      {
        Effect: 'Allow',
        Action: [
          'route53:ListHostedZones',
          'route53:ListResourceRecordSets',
          'route53:ListTagsForResource',
        ],
        Resource: ['*'],
      },
    ],
  },
});

const SERVICE_ACCOUNT_NAME = 'external-dns';

const role = eksServiceAccount('extdns-role', {
  roleName: 'EKSExternalDNS-',
  roleDescription: interpolate`Service account for EKS External DNS (cluster: ${clusterName})`,
  serviceAccountName: SERVICE_ACCOUNT_NAME,
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: [policy.arn],
});

const sa = new k8s.core.v1.ServiceAccount(
  'extdns-sa',
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

const clusterRole = new k8s.rbac.v1.ClusterRole(
  'extdns-cluster-role',
  {
    rules: [
      {
        apiGroups: [''],
        resources: ['services', 'endpoints', 'pods'],
        verbs: ['get', 'watch', 'list'],
      },
      {
        apiGroups: ['extensions', 'networking.k8s.io'],
        resources: ['ingresses'],
        verbs: ['get', 'watch', 'list'],
      },
      {
        apiGroups: [''],
        resources: ['nodes'],
        verbs: ['list', 'watch'],
      },
    ],
  },
  { provider },
);

new k8s.rbac.v1.ClusterRoleBinding(
  'extdns-cluster-role-binding',
  {
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: clusterRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: sa.metadata.name,
        namespace: sa.metadata.namespace,
      },
    ],
  },
  { provider },
);

new k8s.apps.v1.Deployment(
  'extdns',
  {
    metadata: {
      name: 'external-dns',
      namespace: 'kube-system',
    },
    spec: {
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: {
          app: 'external-dns',
        },
      },
      template: {
        metadata: {
          labels: {
            app: 'external-dns',
            'app.kubernetes.io/name': 'external-dns',
          },
        },
        spec: {
          serviceAccountName: SERVICE_ACCOUNT_NAME,
          containers: [
            {
              name: 'external-dns',
              image: 'registry.k8s.io/external-dns/external-dns:v0.16.1',
              args: [
                '--source=service',
                '--source=ingress',
                ...externalDnsZoneDomains.map(
                  (zone) => interpolate`--domain-filter=${zone}`,
                ),
                '--provider=aws',
                '--registry=txt',
                interpolate`--txt-owner-id=k8s-extdns-${clusterName}`,
                '--aws-zone-type=public', // public, private, commented out = both
              ],
              env: [
                {
                  name: 'AWS_REGION',
                  value: awsClassic.config.region,
                },
              ],
            },
          ],
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
            // avoid co-location of redundancy
            podAntiAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: [
                {
                  labelSelector: {
                    matchExpressions: [
                      {
                        key: 'app.kubernetes.io/name',
                        operator: 'In',
                        values: ['external-dns'],
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
    },
  },
  { provider },
);
