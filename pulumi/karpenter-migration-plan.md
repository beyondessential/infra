# Karpenter Migration Plan

Migration from EKS Managed Node Groups + Cluster Autoscaler to Karpenter.

## Current State

- EKS managed node groups defined in `stacks/k8s-core/nodes/groups.ts`
- Cluster Autoscaler deployment in `stacks/k8s-core/nodes/autoscaler.ts`
- Node purposes: `workload`, `ingress`, `system`
- Node schedules: `ondemand`, `spot`
- Node architectures: `arm64`, `amd64`
- Ingress nodes use NAT subnets, workload/system nodes use workload subnets
- Custom labels: `bes.node.purpose`, `bes.node.schedule`, `bes.node.arch`, `bes.node.group`
- Spot instances have taint `spotInstance=true:PreferNoSchedule`

## Goals

1. Least disruption to existing workloads
2. IMDSv2-only (disable IMDSv1)
3. Maintain existing node purpose/schedule/arch labeling scheme
4. Preserve subnet placement logic (ingress in NAT subnets, others in workload subnets)

## Migration Strategy

Run Karpenter and Cluster Autoscaler in parallel during migration:
1. Deploy Karpenter alongside existing setup
2. Gradually shift workloads to Karpenter-managed nodes
3. Scale down managed node groups
4. Remove Cluster Autoscaler and managed node groups

## Implementation Phases

### Phase 1: Karpenter Infrastructure (k8s-core)

New files to create:
- `stacks/k8s-core/karpenter/controller.ts` - Karpenter controller IAM and Helm deployment
- `stacks/k8s-core/karpenter/classes.ts` - EC2NodeClass definitions
- `stacks/k8s-core/karpenter/pools.ts` - NodePool definitions

#### 1.0 Validate Configuration

Karpenter should not run on spot system nodes due to the chicken-and-egg problem during interruptions. Add a validation check:

```ts
// stacks/k8s-core/karpenter/controller.ts (at top of file)

const systemSpot = cfg.getBoolean('systemSpot') ?? false;
if (systemSpot) {
  throw new Error(
    'systemSpot cannot be enabled when using Karpenter. ' +
    'Karpenter must run on on-demand system nodes to avoid interruption issues.'
  );
}
```

#### 1.1 IAM Role for Karpenter Controller

```ts
// stacks/k8s-core/karpenter/controller.ts

const karpenterControllerPolicy = new awsClassic.iam.Policy('karpenter-controller-policy', {
  namePrefix: `EKS${pascalStackName}KarpenterController-`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowScopedEC2InstanceAccessActions',
        Effect: 'Allow',
        Action: ['ec2:RunInstances', 'ec2:CreateFleet'],
        Resource: [
          'arn:aws:ec2:*::image/*',
          'arn:aws:ec2:*::snapshot/*',
          'arn:aws:ec2:*:*:security-group/*',
          'arn:aws:ec2:*:*:subnet/*',
        ],
      },
      {
        Sid: 'AllowScopedEC2InstanceActionsWithTags',
        Effect: 'Allow',
        Action: ['ec2:RunInstances', 'ec2:CreateFleet', 'ec2:CreateLaunchTemplate'],
        Resource: [
          'arn:aws:ec2:*:*:fleet/*',
          'arn:aws:ec2:*:*:instance/*',
          'arn:aws:ec2:*:*:volume/*',
          'arn:aws:ec2:*:*:network-interface/*',
          'arn:aws:ec2:*:*:launch-template/*',
          'arn:aws:ec2:*:*:spot-instances-request/*',
        ],
        Condition: {
          StringEquals: { 'aws:RequestTag/karpenter.sh/nodepool': '*' },
          StringLike: { 'aws:RequestTag/karpenter.sh/managed-by': clusterName },
        },
      },
      {
        Sid: 'AllowScopedResourceCreationTagging',
        Effect: 'Allow',
        Action: 'ec2:CreateTags',
        Resource: [
          'arn:aws:ec2:*:*:fleet/*',
          'arn:aws:ec2:*:*:instance/*',
          'arn:aws:ec2:*:*:volume/*',
          'arn:aws:ec2:*:*:network-interface/*',
          'arn:aws:ec2:*:*:launch-template/*',
          'arn:aws:ec2:*:*:spot-instances-request/*',
        ],
        Condition: { StringEquals: { 'ec2:CreateAction': ['RunInstances', 'CreateFleet', 'CreateLaunchTemplate'] } },
      },
      {
        Sid: 'AllowScopedResourceTagging',
        Effect: 'Allow',
        Action: 'ec2:CreateTags',
        Resource: 'arn:aws:ec2:*:*:instance/*',
        Condition: {
          StringEquals: { 'aws:ResourceTag/karpenter.sh/managed-by': clusterName },
          StringLike: { 'aws:RequestTag/karpenter.sh/nodepool': '*' },
          ForAllValues: { 'StringEquals': { 'aws:TagKeys': ['karpenter.sh/nodepool'] } },
        },
      },
      {
        Sid: 'AllowScopedDeletion',
        Effect: 'Allow',
        Action: ['ec2:TerminateInstances', 'ec2:DeleteLaunchTemplate'],
        Resource: ['arn:aws:ec2:*:*:instance/*', 'arn:aws:ec2:*:*:launch-template/*'],
        Condition: { StringEquals: { 'aws:ResourceTag/karpenter.sh/managed-by': clusterName } },
      },
      {
        Sid: 'AllowRegionalReadActions',
        Effect: 'Allow',
        Action: [
          'ec2:DescribeAvailabilityZones',
          'ec2:DescribeImages',
          'ec2:DescribeInstances',
          'ec2:DescribeInstanceTypeOfferings',
          'ec2:DescribeInstanceTypes',
          'ec2:DescribeLaunchTemplates',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeSpotPriceHistory',
          'ec2:DescribeSubnets',
        ],
        Resource: '*',
      },
      {
        Sid: 'AllowSSMReadActions',
        Effect: 'Allow',
        Action: 'ssm:GetParameter',
        Resource: 'arn:aws:ssm:*:*:parameter/aws/service/*',
      },
      {
        Sid: 'AllowPricingReadActions',
        Effect: 'Allow',
        Action: 'pricing:GetProducts',
        Resource: '*',
      },
      {
        Sid: 'AllowInterruptionQueueActions',
        Effect: 'Allow',
        Action: ['sqs:DeleteMessage', 'sqs:GetQueueUrl', 'sqs:ReceiveMessage'],
        Resource: interpolate`arn:aws:sqs:${region}:${accountId}:${clusterName}`,
      },
      {
        Sid: 'AllowPassingInstanceRole',
        Effect: 'Allow',
        Action: 'iam:PassRole',
        Resource: nodeRole.arn,
        Condition: { StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' } },
      },
      {
        Sid: 'AllowScopedInstanceProfileCreationActions',
        Effect: 'Allow',
        Action: ['iam:CreateInstanceProfile'],
        Resource: '*',
        Condition: {
          StringEquals: { 'aws:RequestTag/karpenter.sh/managed-by': clusterName },
          StringLike: { 'aws:RequestTag/kubernetes.io/cluster/*': 'owned' },
        },
      },
      {
        Sid: 'AllowScopedInstanceProfileTagActions',
        Effect: 'Allow',
        Action: 'iam:TagInstanceProfile',
        Resource: '*',
        Condition: {
          StringEquals: {
            'aws:ResourceTag/karpenter.sh/managed-by': clusterName,
            'aws:RequestTag/karpenter.sh/managed-by': clusterName,
          },
          StringLike: {
            'aws:ResourceTag/kubernetes.io/cluster/*': 'owned',
            'aws:RequestTag/kubernetes.io/cluster/*': 'owned',
          },
        },
      },
      {
        Sid: 'AllowScopedInstanceProfileActions',
        Effect: 'Allow',
        Action: ['iam:AddRoleToInstanceProfile', 'iam:RemoveRoleFromInstanceProfile', 'iam:DeleteInstanceProfile'],
        Resource: '*',
        Condition: {
          StringEquals: { 'aws:ResourceTag/karpenter.sh/managed-by': clusterName },
          StringLike: { 'aws:ResourceTag/kubernetes.io/cluster/*': 'owned' },
        },
      },
      {
        Sid: 'AllowInstanceProfileReadActions',
        Effect: 'Allow',
        Action: 'iam:GetInstanceProfile',
        Resource: '*',
      },
      {
        Sid: 'AllowAPIServerEndpointDiscovery',
        Effect: 'Allow',
        Action: 'eks:DescribeCluster',
        Resource: interpolate`arn:aws:eks:${region}:${accountId}:cluster/${clusterName}`,
      },
    ],
  },
});

const karpenterControllerRole = eksServiceAccount('karpenter-controller-role', {
  roleName: `EKS${pascalStackName}KarpenterController-`,
  roleDescription: interpolate`Karpenter controller for EKS cluster ${clusterName}`,
  serviceAccountName: 'karpenter',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: [karpenterControllerPolicy.arn],
});
```

#### 1.2 Interruption Handling (SQS Queue)

```ts
// Add to stacks/k8s-core/karpenter/controller.ts

const interruptionQueue = new awsClassic.sqs.Queue('karpenter-interruption', {
  namePrefix: clusterName,
  messageRetentionSeconds: 300,
  sqsManagedSseEnabled: true,
  tags,
});

const interruptionQueuePolicy = new awsClassic.sqs.QueuePolicy('karpenter-interruption-policy', {
  queueUrl: interruptionQueue.url,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: ['events.amazonaws.com', 'sqs.amazonaws.com'] },
        Action: 'sqs:SendMessage',
        Resource: interruptionQueue.arn,
      },
    ],
  },
});

// EventBridge rules for spot interruption, rebalance, state change, health events
const scheduledChangeRule = new awsClassic.cloudwatch.EventRule('karpenter-scheduled-change', {
  eventPattern: JSON.stringify({
    source: ['aws.health'],
    'detail-type': ['AWS Health Event'],
  }),
  tags,
});

new awsClassic.cloudwatch.EventTarget('karpenter-scheduled-change-target', {
  rule: scheduledChangeRule.name,
  arn: interruptionQueue.arn,
});

const spotInterruptionRule = new awsClassic.cloudwatch.EventRule('karpenter-spot-interruption', {
  eventPattern: JSON.stringify({
    source: ['aws.ec2'],
    'detail-type': ['EC2 Spot Instance Interruption Warning'],
  }),
  tags,
});

new awsClassic.cloudwatch.EventTarget('karpenter-spot-interruption-target', {
  rule: spotInterruptionRule.name,
  arn: interruptionQueue.arn,
});

const rebalanceRule = new awsClassic.cloudwatch.EventRule('karpenter-rebalance', {
  eventPattern: JSON.stringify({
    source: ['aws.ec2'],
    'detail-type': ['EC2 Instance Rebalance Recommendation'],
  }),
  tags,
});

new awsClassic.cloudwatch.EventTarget('karpenter-rebalance-target', {
  rule: rebalanceRule.name,
  arn: interruptionQueue.arn,
});

const stateChangeRule = new awsClassic.cloudwatch.EventRule('karpenter-state-change', {
  eventPattern: JSON.stringify({
    source: ['aws.ec2'],
    'detail-type': ['EC2 Instance State-change Notification'],
  }),
  tags,
});

new awsClassic.cloudwatch.EventTarget('karpenter-state-change-target', {
  rule: stateChangeRule.name,
  arn: interruptionQueue.arn,
});
```

#### 1.3 Karpenter Helm Deployment

```ts
// Add to stacks/k8s-core/karpenter/controller.ts

const karpenter = new k8s.helm.v3.Release('karpenter', {
  namespace: 'kube-system',
  chart: 'karpenter',
  version: '1.1.1', // check for latest
  repositoryOpts: { repo: 'oci://public.ecr.aws/karpenter' },
  values: {
    serviceAccount: {
      annotations: {
        'eks.amazonaws.com/role-arn': karpenterControllerRole.arn,
      },
    },
    settings: {
      clusterName,
      clusterEndpoint: cluster.endpoint,
      interruptionQueue: interruptionQueue.name,
    },
    controller: {
      resources: {
        requests: { cpu: '100m', memory: '256Mi' },
        limits: { memory: '512Mi' },
      },
    },
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{
            matchExpressions: [
              { key: 'bes.node.purpose', operator: 'In', values: ['system'] },
            ],
          }],
        },
      },
    },
    tolerations: [
      { key: 'CriticalAddonsOnly', operator: 'Exists' },
    ],
  },
}, { provider });
```

### Phase 2: EC2NodeClass Definitions

Create EC2NodeClass resources that mirror current node group configurations.

```ts
// stacks/k8s-core/karpenter/classes.ts

// Common security settings
const commonMetadataOptions = {
  httpEndpoint: 'enabled',
  httpProtocolIPv6: 'disabled',
  httpPutResponseHopLimit: 2,
  httpTokens: 'required', // IMDSv2 only
};

// Workload nodes - in workload subnets
const workloadNodeClass = new k8s.apiextensions.CustomResource('nodeclass-workload', {
  apiVersion: 'karpenter.k8s.aws/v1',
  kind: 'EC2NodeClass',
  metadata: { name: 'workload' },
  spec: {
    role: nodeRoleName, // just the name, not ARN
    amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
    subnetSelectorTerms: [{ tags: { Purpose: 'k8s-workload' } }], // tag workload subnets
    securityGroupSelectorTerms: [{ tags: { 'kubernetes.io/cluster': clusterName } }],
    metadataOptions: commonMetadataOptions,
    blockDeviceMappings: [{
      deviceName: '/dev/xvda',
      ebs: {
        volumeSize: '25Gi',
        volumeType: 'gp3',
        encrypted: true,
      },
    }],
    tags: {
      'bes.node.purpose': 'workload',
      ...tags,
    },
  },
}, { provider, dependsOn: [karpenter] });

// Ingress nodes - in NAT subnets (public)
const ingressNodeClass = new k8s.apiextensions.CustomResource('nodeclass-ingress', {
  apiVersion: 'karpenter.k8s.aws/v1',
  kind: 'EC2NodeClass',
  metadata: { name: 'ingress' },
  spec: {
    role: nodeRoleName,
    amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
    subnetSelectorTerms: [{ tags: { Purpose: 'k8s-nat' } }], // tag NAT subnets
    securityGroupSelectorTerms: [{ tags: { 'kubernetes.io/cluster': clusterName } }],
    metadataOptions: commonMetadataOptions,
    blockDeviceMappings: [{
      deviceName: '/dev/xvda',
      ebs: {
        volumeSize: '25Gi',
        volumeType: 'gp3',
        encrypted: true,
      },
    }],
    tags: {
      'bes.node.purpose': 'ingress',
      ...tags,
    },
  },
}, { provider, dependsOn: [karpenter] });

// System nodes - in workload subnets
const systemNodeClass = new k8s.apiextensions.CustomResource('nodeclass-system', {
  apiVersion: 'karpenter.k8s.aws/v1',
  kind: 'EC2NodeClass',
  metadata: { name: 'system' },
  spec: {
    role: nodeRoleName,
    amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
    subnetSelectorTerms: [{ tags: { Purpose: 'k8s-workload' } }],
    securityGroupSelectorTerms: [{ tags: { 'kubernetes.io/cluster': clusterName } }],
    metadataOptions: commonMetadataOptions,
    blockDeviceMappings: [{
      deviceName: '/dev/xvda',
      ebs: {
        volumeSize: '25Gi',
        volumeType: 'gp3',
        encrypted: true,
      },
    }],
    tags: {
      'bes.node.purpose': 'system',
      ...tags,
    },
  },
}, { provider, dependsOn: [karpenter] });
```

### Phase 3: NodePool Definitions

Create NodePool resources to replace each managed node group type.

```ts
// stacks/k8s-core/karpenter/pools.ts

// Workload ARM64 Spot (high priority)
new k8s.apiextensions.CustomResource('nodepool-workload-arm-spot', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'workload-arm-spot' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'workload',
          'bes.node.schedule': 'spot',
          'bes.node.arch': 'arm64',
          'bes.node.group': 'workload-arm-spot',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'workload' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm', 'r'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['4', '8', '16'] },
        ],
        taints: [
          { key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' },
        ],
      },
    },
    limits: { cpu: 1000, memory: '2000Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '5m',
    },
    weight: 80, // highest priority for ARM spot
  },
}, { provider, dependsOn: [workloadNodeClass] });

// Workload ARM64 On-Demand
new k8s.apiextensions.CustomResource('nodepool-workload-arm-ondemand', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'workload-arm-ondemand' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'workload',
          'bes.node.schedule': 'ondemand',
          'bes.node.arch': 'arm64',
          'bes.node.group': 'workload-arm-ondemand',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'workload' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['on-demand'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['t', 'c', 'm', 'r'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['2', '4', '8'] },
        ],
      },
    },
    limits: { cpu: 500, memory: '1000Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '5m',
    },
    weight: 30,
  },
}, { provider, dependsOn: [workloadNodeClass] });

// Workload x86 Spot
new k8s.apiextensions.CustomResource('nodepool-workload-x86-spot', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'workload-x86-spot' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'workload',
          'bes.node.schedule': 'spot',
          'bes.node.arch': 'amd64',
          'bes.node.group': 'workload-x86-spot',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'workload' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm', 'r'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['4', '8', '16'] },
        ],
        taints: [
          { key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' },
        ],
      },
    },
    limits: { cpu: 500, memory: '1000Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '5m',
    },
    weight: 60,
  },
}, { provider, dependsOn: [workloadNodeClass] });

// Workload x86 On-Demand
new k8s.apiextensions.CustomResource('nodepool-workload-x86-ondemand', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'workload-x86-ondemand' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'workload',
          'bes.node.schedule': 'ondemand',
          'bes.node.arch': 'amd64',
          'bes.node.group': 'workload-x86-ondemand',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'workload' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['on-demand'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['t', 'c', 'm', 'r'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['2', '4', '8'] },
        ],
      },
    },
    limits: { cpu: 500, memory: '1000Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '5m',
    },
    weight: 10,
  },
}, { provider, dependsOn: [workloadNodeClass] });

// Ingress ARM64 (prefer spot, fallback on-demand)
new k8s.apiextensions.CustomResource('nodepool-ingress-arm', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'ingress-arm' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'ingress',
          'bes.node.arch': 'arm64',
          'bes.node.group': 'ingress-arm',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'ingress' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm', 'r'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['2', '4'] },
        ],
      },
    },
    limits: { cpu: 100, memory: '200Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '10m',
    },
    weight: 50,
  },
}, { provider, dependsOn: [ingressNodeClass] });

// System ARM64 (on-demand for stability)
new k8s.apiextensions.CustomResource('nodepool-system-arm', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'system-arm' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'system',
          'bes.node.schedule': 'ondemand',
          'bes.node.arch': 'arm64',
          'bes.node.group': 'system-arm',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'system' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['on-demand'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['t'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['2', '4'] },
        ],
      },
    },
    limits: { cpu: 50, memory: '100Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmpty',
      consolidateAfter: '30m',
    },
    weight: 40,
  },
}, { provider, dependsOn: [systemNodeClass] });

// System x86 (for HNC or other x86-only workloads)
new k8s.apiextensions.CustomResource('nodepool-system-x86', {
  apiVersion: 'karpenter.sh/v1',
  kind: 'NodePool',
  metadata: { name: 'system-x86' },
  spec: {
    template: {
      metadata: {
        labels: {
          'bes.node.purpose': 'system',
          'bes.node.schedule': 'spot',
          'bes.node.arch': 'amd64',
          'bes.node.group': 'system-x86',
        },
      },
      spec: {
        nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'system' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'In', values: ['2', '4'] },
        ],
        taints: [
          { key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' },
        ],
      },
    },
    limits: { cpu: 50, memory: '100Gi' },
    disruption: {
      consolidationPolicy: 'WhenEmptyOrUnderutilized',
      consolidateAfter: '10m',
    },
    weight: 20,
  },
}, { provider, dependsOn: [systemNodeClass] });
```

### Phase 4: Subnet Tagging

Add tags to subnets for Karpenter discovery. Update `stacks/common/Network.ts`:

```ts
// In natSubnet():
tags: {
  // ... existing tags
  Purpose: 'k8s-nat',
  'karpenter.sh/discovery': clusterName, // if cluster-specific
}

// In workloadSubnet():
tags: {
  // ... existing tags
  Purpose: 'k8s-workload',
  'karpenter.sh/discovery': clusterName,
}
```

### Phase 5: Parallel Operation

1. Deploy Karpenter with all NodePools (Phase 1-4)
2. Karpenter and Cluster Autoscaler run in parallel
3. Both can provision nodes; existing managed node groups continue to work
4. Verify Karpenter is functioning: `kubectl get nodepools`, `kubectl get ec2nodeclasses`

### Phase 6: Gradual Migration

1. Scale down managed node group min sizes to 0 (except system nodes initially)
2. Let Cluster Autoscaler scale down empty managed nodes
3. New pods will be scheduled on Karpenter-provisioned nodes
4. Monitor for issues

```ts
// In groups.ts, change minPerAz to 0 for workload/ingress groups
// Keep system nodes with minPerAz: 1 until Karpenter system nodes are proven stable
```

### Phase 7: Cleanup

Once satisfied with Karpenter operation:

1. Remove Cluster Autoscaler deployment from `nodes/autoscaler.ts`
2. Remove managed node groups from `nodes/groups.ts`
3. Remove autoscaler policy from `nodes/policy.ts`
4. Update `index.ts` to import Karpenter files instead

## Rollback Plan

If issues occur:

1. Scale managed node groups back up (increase minPerAz)
2. Delete Karpenter NodePools (prevents new Karpenter nodes)
3. Drain Karpenter-provisioned nodes: `kubectl drain --ignore-daemonsets <node>`
4. Karpenter will terminate drained nodes automatically
5. Remove Karpenter Helm release if needed

## Monitoring

- Karpenter metrics: `karpenter_nodes_*`, `karpenter_provisioner_*`
- Check for pending pods: `kubectl get pods --all-namespaces --field-selector=status.phase=Pending`
- Node provisioning latency
- Spot interruption handling

## Config Toggle

Add a config option to enable Karpenter:

```ts
// In index.ts
const useKarpenter = cfg.getBoolean('useKarpenter') ?? false;

if (useKarpenter) {
  import('./karpenter/controller.ts');
  import('./karpenter/classes.ts');
  import('./karpenter/pools.ts');
} else {
  import('./nodes/groups.ts');
  import('./nodes/autoscaler.ts');
}
```

## Estimated Timeline

- Phase 1-4: 1-2 days (implementation)
- Phase 5: 1 day (parallel operation testing)
- Phase 6: 1-2 weeks (gradual migration, monitoring)
- Phase 7: 1 day (cleanup)

Total: ~3 weeks for safe migration with buffer for issues.