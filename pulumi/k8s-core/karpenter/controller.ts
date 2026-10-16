import { all, interpolate, type Input, type Resource } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { cfg, pascalStackName } from '../../common/coreRef.ts';
import { region, accountId, partition } from '../../common/awsAccount.ts';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { provider } from '../kubeconfig.ts';
import { clusterName, oidcProvider, tags } from '../cluster.ts';
import { nodeRole } from '../roles.ts';
import { withBootstrap } from '../nodes/groups.ts';

// HA design for the controller:
// (1) replicas: 2 (chart default).
// (2) capacity-type spread (DoNotSchedule, see below) — exactly one replica
//     on spot, exactly one on on-demand. A spot drought can take down at
//     most one controller at a time.
// (3) system-arm NodePool (on-demand) and system-arm-spot NodePool both
//     unconditionally present in pools.ts — Karpenter always has somewhere
//     to provision either capacity type when a controller pod is pending.

// spec: K8SNOD#interruption-and-consolidation
// SQS queue receiving spot interruption notices, rebalance recommendations,
// instance state changes, and AWS Health events. Karpenter cordons + drains
// nodes proactively when these arrive.
const interruptionQueue = new awsClassic.sqs.Queue('karpenter-interruption', {
  namePrefix: interpolate`${clusterName}-karpenter-`,
  messageRetentionSeconds: 300,
  sqsManagedSseEnabled: true,
  tags,
});

new awsClassic.sqs.QueuePolicy('karpenter-interruption-policy', {
  queueUrl: interruptionQueue.url,
  policy: interruptionQueue.arn.apply((arn) =>
    JSON.stringify({
      Version: '2012-10-17',
      Id: 'EC2InterruptionPolicy',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: ['events.amazonaws.com', 'sqs.amazonaws.com'] },
          Action: 'sqs:SendMessage',
          Resource: arn,
        },
        {
          Sid: 'DenyHTTP',
          Effect: 'Deny',
          Principal: '*',
          Action: 'sqs:*',
          Resource: arn,
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
      ],
    }),
  ),
});

const eventRules: { name: string; pattern: Record<string, string[]> }[] = [
  {
    name: 'scheduled-change',
    pattern: { source: ['aws.health'], 'detail-type': ['AWS Health Event'] },
  },
  {
    name: 'spot-interruption',
    pattern: { source: ['aws.ec2'], 'detail-type': ['EC2 Spot Instance Interruption Warning'] },
  },
  {
    name: 'rebalance',
    pattern: { source: ['aws.ec2'], 'detail-type': ['EC2 Instance Rebalance Recommendation'] },
  },
  {
    name: 'state-change',
    pattern: { source: ['aws.ec2'], 'detail-type': ['EC2 Instance State-change Notification'] },
  },
];

for (const { name, pattern } of eventRules) {
  const rule = new awsClassic.cloudwatch.EventRule(`karpenter-${name}`, {
    eventPattern: JSON.stringify(pattern),
    tags,
  });
  new awsClassic.cloudwatch.EventTarget(`karpenter-${name}-target`, {
    rule: rule.name,
    arn: interruptionQueue.arn,
  });
}

// IAM policy combining Karpenter's upstream KarpenterController* managed
// policies (v1.12.0 cloudformation reference). Single inline policy attached
// to the controller's IRSA role.
const karpenterControllerPolicy = new awsClassic.iam.Policy('karpenter-controller-policy', {
  namePrefix: `EKS${pascalStackName}KarpenterController-`,
  policy: all([clusterName, accountId, partition, nodeRole.arn, interruptionQueue.arn]).apply(
    ([cn, aid, part, nodeRoleArn, queueArn]) => {
      const clusterTagKey = `kubernetes.io/cluster/${cn}`;
      return JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowScopedEC2InstanceAccessActions',
            Effect: 'Allow',
            Resource: [
              `arn:${part}:ec2:${region}::image/*`,
              `arn:${part}:ec2:${region}::snapshot/*`,
              `arn:${part}:ec2:${region}:*:security-group/*`,
              `arn:${part}:ec2:${region}:*:subnet/*`,
              `arn:${part}:ec2:${region}:*:capacity-reservation/*`,
              `arn:${part}:ec2:${region}:*:placement-group/*`,
            ],
            Action: ['ec2:RunInstances', 'ec2:CreateFleet'],
          },
          {
            Sid: 'AllowScopedEC2LaunchTemplateAccessActions',
            Effect: 'Allow',
            Resource: `arn:${part}:ec2:${region}:*:launch-template/*`,
            Action: ['ec2:RunInstances', 'ec2:CreateFleet'],
            Condition: {
              StringEquals: { [`aws:ResourceTag/${clusterTagKey}`]: 'owned' },
              StringLike: { 'aws:ResourceTag/karpenter.sh/nodepool': '*' },
            },
          },
          {
            Sid: 'AllowScopedEC2InstanceActionsWithTags',
            Effect: 'Allow',
            Resource: [
              `arn:${part}:ec2:${region}:*:fleet/*`,
              `arn:${part}:ec2:${region}:*:instance/*`,
              `arn:${part}:ec2:${region}:*:volume/*`,
              `arn:${part}:ec2:${region}:*:network-interface/*`,
              `arn:${part}:ec2:${region}:*:launch-template/*`,
              `arn:${part}:ec2:${region}:*:spot-instances-request/*`,
            ],
            Action: ['ec2:RunInstances', 'ec2:CreateFleet', 'ec2:CreateLaunchTemplate'],
            Condition: {
              StringEquals: {
                [`aws:RequestTag/${clusterTagKey}`]: 'owned',
                'aws:RequestTag/eks:eks-cluster-name': cn,
              },
              StringLike: { 'aws:RequestTag/karpenter.sh/nodepool': '*' },
            },
          },
          {
            Sid: 'AllowScopedResourceCreationTagging',
            Effect: 'Allow',
            Resource: [
              `arn:${part}:ec2:${region}:*:fleet/*`,
              `arn:${part}:ec2:${region}:*:instance/*`,
              `arn:${part}:ec2:${region}:*:volume/*`,
              `arn:${part}:ec2:${region}:*:network-interface/*`,
              `arn:${part}:ec2:${region}:*:launch-template/*`,
              `arn:${part}:ec2:${region}:*:spot-instances-request/*`,
            ],
            Action: 'ec2:CreateTags',
            Condition: {
              StringEquals: {
                [`aws:RequestTag/${clusterTagKey}`]: 'owned',
                'aws:RequestTag/eks:eks-cluster-name': cn,
                'ec2:CreateAction': ['RunInstances', 'CreateFleet', 'CreateLaunchTemplate'],
              },
              StringLike: { 'aws:RequestTag/karpenter.sh/nodepool': '*' },
            },
          },
          {
            Sid: 'AllowScopedResourceTagging',
            Effect: 'Allow',
            Resource: `arn:${part}:ec2:${region}:*:instance/*`,
            Action: 'ec2:CreateTags',
            Condition: {
              StringEquals: { [`aws:ResourceTag/${clusterTagKey}`]: 'owned' },
              StringLike: { 'aws:ResourceTag/karpenter.sh/nodepool': '*' },
              StringEqualsIfExists: { 'aws:RequestTag/eks:eks-cluster-name': cn },
              'ForAllValues:StringEquals': {
                'aws:TagKeys': ['eks:eks-cluster-name', 'karpenter.sh/nodeclaim', 'Name'],
              },
            },
          },
          {
            Sid: 'AllowScopedDeletion',
            Effect: 'Allow',
            Resource: [
              `arn:${part}:ec2:${region}:*:instance/*`,
              `arn:${part}:ec2:${region}:*:launch-template/*`,
            ],
            Action: ['ec2:TerminateInstances', 'ec2:DeleteLaunchTemplate'],
            Condition: {
              StringEquals: { [`aws:ResourceTag/${clusterTagKey}`]: 'owned' },
              StringLike: { 'aws:ResourceTag/karpenter.sh/nodepool': '*' },
            },
          },
          {
            Sid: 'AllowRegionalReadActions',
            Effect: 'Allow',
            Resource: '*',
            Action: [
              'ec2:DescribeCapacityReservations',
              'ec2:DescribeImages',
              'ec2:DescribeInstances',
              'ec2:DescribeInstanceTypeOfferings',
              'ec2:DescribeInstanceTypes',
              'ec2:DescribeLaunchTemplates',
              'ec2:DescribePlacementGroups',
              'ec2:DescribeSecurityGroups',
              'ec2:DescribeSpotPriceHistory',
              'ec2:DescribeSubnets',
            ],
            Condition: { StringEquals: { 'aws:RequestedRegion': region } },
          },
          {
            Sid: 'AllowSSMReadActions',
            Effect: 'Allow',
            Resource: `arn:${part}:ssm:${region}::parameter/aws/service/*`,
            Action: 'ssm:GetParameter',
          },
          {
            Sid: 'AllowPricingReadActions',
            Effect: 'Allow',
            Resource: '*',
            Action: 'pricing:GetProducts',
          },
          {
            Sid: 'AllowInterruptionQueueActions',
            Effect: 'Allow',
            Resource: queueArn,
            Action: ['sqs:DeleteMessage', 'sqs:GetQueueUrl', 'sqs:ReceiveMessage'],
          },
          {
            Sid: 'AllowPassingInstanceRole',
            Effect: 'Allow',
            Resource: nodeRoleArn,
            Action: 'iam:PassRole',
            Condition: {
              StringEquals: { 'iam:PassedToService': ['ec2.amazonaws.com', 'ec2.amazonaws.com.cn'] },
            },
          },
          {
            Sid: 'AllowScopedInstanceProfileCreationActions',
            Effect: 'Allow',
            Resource: `arn:${part}:iam::${aid}:instance-profile/*`,
            Action: 'iam:CreateInstanceProfile',
            Condition: {
              StringEquals: {
                [`aws:RequestTag/${clusterTagKey}`]: 'owned',
                'aws:RequestTag/eks:eks-cluster-name': cn,
                'aws:RequestTag/topology.kubernetes.io/region': region,
              },
              StringLike: { 'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*' },
            },
          },
          {
            Sid: 'AllowScopedInstanceProfileTagActions',
            Effect: 'Allow',
            Resource: `arn:${part}:iam::${aid}:instance-profile/*`,
            Action: 'iam:TagInstanceProfile',
            Condition: {
              StringEquals: {
                [`aws:ResourceTag/${clusterTagKey}`]: 'owned',
                'aws:ResourceTag/topology.kubernetes.io/region': region,
                [`aws:RequestTag/${clusterTagKey}`]: 'owned',
                'aws:RequestTag/eks:eks-cluster-name': cn,
                'aws:RequestTag/topology.kubernetes.io/region': region,
              },
              StringLike: {
                'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*',
                'aws:RequestTag/karpenter.k8s.aws/ec2nodeclass': '*',
              },
            },
          },
          {
            Sid: 'AllowScopedInstanceProfileActions',
            Effect: 'Allow',
            Resource: `arn:${part}:iam::${aid}:instance-profile/*`,
            Action: [
              'iam:AddRoleToInstanceProfile',
              'iam:RemoveRoleFromInstanceProfile',
              'iam:DeleteInstanceProfile',
            ],
            Condition: {
              StringEquals: {
                [`aws:ResourceTag/${clusterTagKey}`]: 'owned',
                'aws:ResourceTag/topology.kubernetes.io/region': region,
              },
              StringLike: { 'aws:ResourceTag/karpenter.k8s.aws/ec2nodeclass': '*' },
            },
          },
          {
            Sid: 'AllowInstanceProfileReadActions',
            Effect: 'Allow',
            Resource: `arn:${part}:iam::${aid}:instance-profile/*`,
            Action: 'iam:GetInstanceProfile',
          },
          {
            Sid: 'AllowUnscopedInstanceProfileListAction',
            Effect: 'Allow',
            Resource: '*',
            Action: 'iam:ListInstanceProfiles',
          },
          {
            Sid: 'AllowAPIServerEndpointDiscovery',
            Effect: 'Allow',
            Resource: `arn:${part}:eks:${region}:${aid}:cluster/${cn}`,
            Action: 'eks:DescribeCluster',
          },
        ],
      });
    },
  ),
});

const karpenterControllerRole = eksServiceAccount('karpenter-controller-role', {
  roleName: `EKS${pascalStackName}KarpenterController-`,
  roleDescription: interpolate`Karpenter controller for EKS cluster ${clusterName}`,
  serviceAccountName: 'karpenter',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: [karpenterControllerPolicy.arn],
});

// Pre-created ServiceAccount; Helm release is configured to use this rather
// than create its own.
const karpenterSa = new k8s.core.v1.ServiceAccount(
  'karpenter-sa',
  {
    metadata: {
      name: 'karpenter',
      namespace: 'kube-system',
      annotations: {
        'eks.amazonaws.com/role-arn': karpenterControllerRole.arn,
      },
    },
  },
  { provider },
);

// Pin to the latest 1.x at writing time. New AMIs roll out roughly weekly,
// chart releases more often — bump deliberately.
const KARPENTER_VERSION = '1.12.0';

// LBC must be installed before Karpenter — index.ts imports them in that
// order today, but the dependency is implicit. Re-import here (cached module,
// no extra resource creation) so we can wire it as an explicit dependsOn on
// the Karpenter helm release. Skipped when LBC is disabled.
const extraDeps: Input<Resource>[] = [];
if (cfg.getBoolean('enableAwsLb') ?? true) {
  const { lbc } = await import('../loadbalancer/ingress.ts');
  extraDeps.push(lbc);
}

// Karpenter is allowed to run on Karpenter-provisioned system nodes. The
// `karpenter.sh/do-not-disrupt` annotation tells Karpenter not to consolidate
// or drift-replace its own pod, so it doesn't evict itself. This is the
// official pattern for self-hosted Karpenter (per upstream docs).
export const karpenter = new k8s.helm.v3.Release(
  'karpenter',
  {
    namespace: 'kube-system',
    chart: 'oci://public.ecr.aws/karpenter/karpenter',
    version: KARPENTER_VERSION,
    values: {
      serviceAccount: {
        create: false,
        name: karpenterSa.metadata.name,
      },
      settings: {
        clusterName,
        interruptionQueue: interruptionQueue.name,
      },
      controller: {
        resources: {
          requests: { cpu: '100m', memory: '256Mi' },
          limits: { memory: '512Mi' },
        },
      },
      podAnnotations: {
        'karpenter.sh/do-not-disrupt': 'true',
      },
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'bes.node.purpose', operator: 'In', values: ['system'] },
                ],
              },
            ],
          },
        },
      },
      // With replicas: 2 and capacity-type maxSkew: 1 + DoNotSchedule, exactly
      // one replica is forced onto each capacity type. A pending replica
      // wanting on-demand triggers Karpenter (running on the other replica) to
      // provision an on-demand system node from the system-arm pool. So a spot
      // drought can never take both controllers down — the on-demand replica
      // survives, provisions replacement spot capacity, and the spot replica
      // reschedules.
      topologySpreadConstraints: [
        {
          maxSkew: 1,
          topologyKey: 'kubernetes.io/hostname',
          whenUnsatisfiable: 'ScheduleAnyway',
          labelSelector: {
            matchLabels: {
              'app.kubernetes.io/instance': 'karpenter',
              'app.kubernetes.io/name': 'karpenter',
            },
          },
        },
        {
          maxSkew: 1,
          topologyKey: 'karpenter.sh/capacity-type',
          whenUnsatisfiable: 'DoNotSchedule',
          labelSelector: {
            matchLabels: {
              'app.kubernetes.io/instance': 'karpenter',
              'app.kubernetes.io/name': 'karpenter',
            },
          },
        },
      ],
      tolerations: [{ key: 'CriticalAddonsOnly', operator: 'Exists' }],
    },
  },
  { provider, dependsOn: withBootstrap(extraDeps) },
);
