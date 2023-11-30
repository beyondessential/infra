import { interpolate } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import { pascalStackName } from '../../common/coreRef.js';
import { eksServiceAccount } from '../../common/eksServiceAccount.js';
import { provider } from '../kubeconfig.js';
import { clusterName, oidcProvider } from '../cluster.js';

const SERVICE_ACCOUNT_NAME = 'autoscaler';
const namespace = 'kube-system';

// https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/README.md#full-cluster-autoscaler-features-policy-recommended
const policy = new awsClassic.iam.Policy('autoscaler-oidc-policy', {
  namePrefix: `EKS${pascalStackName}AutoScalerController-`,
  description: interpolate`Policy for EKS AutoScaler controller (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:DescribeAutoScalingInstances',
          'autoscaling:DescribeLaunchConfigurations',
          'autoscaling:DescribeScalingActivities',
          'autoscaling:DescribeTags',
          'ec2:DescribeLaunchTemplateVersions',
          'ec2:DescribeImages',
          'ec2:DescribeInstanceTypes',
          'ec2:GetInstanceTypesFromInstanceRequirements',
          'eks:DescribeNodegroup',
        ],
        Resource: ['*'],
      },
      {
        Effect: 'Allow',
        Action: [
          'autoscaling:SetDesiredCapacity',
          'autoscaling:TerminateInstanceInAutoScalingGroup',
        ],
        Resource: ['*'],
        // TODO: make this work
        // Condition: {
        //   StringEquals: {
        //     'autoscaling:ResourceTag/EKSCluster': clusterName,
        //   },
        // },
      },
    ],
  },
});

const role = eksServiceAccount('autoscaler-sa-role', {
  roleName: `EKS${pascalStackName}AutoScalerController-`,
  roleDescription: interpolate`Service account for AWS EKS Load Balancer Controller (cluster: ${clusterName})`,
  serviceAccountName: SERVICE_ACCOUNT_NAME,
  oidcProviderArn: oidcProvider.arn,
  namespace,
  managedPolicyArns: [policy.arn],
});

// Setup from https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml

const labels = {
  'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
  'k8s-app': 'cluster-autoscaler',
};

const sa = new k8s.core.v1.ServiceAccount(
  'autoscaler-sa',
  {
    metadata: {
      name: SERVICE_ACCOUNT_NAME,
      namespace,
      labels,
      annotations: {
        'eks.amazonaws.com/role-arn': role.arn,
      },
    },
  },
  { provider },
);

const rbacClusterRole = new k8s.rbac.v1.ClusterRole(
  'autoscaler-rbac-cluster-role',
  {
    metadata: {
      labels,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['events', 'endpoints'],
        verbs: ['create', 'patch'],
      },
      {
        apiGroups: [''],
        resources: ['pods/eviction'],
        verbs: ['create'],
      },
      {
        apiGroups: [''],
        resources: ['pods/status'],
        verbs: ['update'],
      },
      {
        apiGroups: [''],
        resources: ['endpoints'],
        resourceNames: ['cluster-autoscaler'],
        verbs: ['get', 'update'],
      },
      {
        apiGroups: [''],
        resources: ['nodes'],
        verbs: ['watch', 'list', 'get', 'update'],
      },
      {
        apiGroups: [''],
        resources: [
          'namespaces',
          'pods',
          'services',
          'replicationcontrollers',
          'persistentvolumeclaims',
          'persistentvolumes',
        ],
        verbs: ['watch', 'list', 'get'],
      },
      {
        apiGroups: ['extensions'],
        resources: ['replicasets', 'daemonsets'],
        verbs: ['watch', 'list', 'get'],
      },
      {
        apiGroups: ['policy'],
        resources: ['poddisruptionbudgets'],
        verbs: ['watch', 'list'],
      },
      {
        apiGroups: ['apps'],
        resources: ['statefulsets', 'replicasets', 'daemonsets'],
        verbs: ['watch', 'list', 'get'],
      },
      {
        apiGroups: ['storage.k8s.io'],
        resources: ['storageclasses', 'csinodes', 'csidrivers', 'csistoragecapacities'],
        verbs: ['watch', 'list', 'get'],
      },
      {
        apiGroups: ['batch', 'extensions'],
        resources: ['jobs'],
        verbs: ['get', 'list', 'watch', 'patch'],
      },
      {
        apiGroups: ['coordination.k8s.io'],
        resources: ['leases'],
        verbs: ['create'],
      },
      {
        apiGroups: ['coordination.k8s.io'],
        resourceNames: ['cluster-autoscaler'],
        resources: ['leases'],
        verbs: ['get', 'update'],
      },
    ],
  },
  { provider },
);

const rbacRole = new k8s.rbac.v1.Role(
  'autoscaler-rbac-role',
  {
    metadata: {
      namespace,
      labels,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['configmaps'],
        verbs: ['create', 'list', 'watch'],
      },
      {
        apiGroups: [''],
        resources: ['configmaps'],
        resourceNames: ['cluster-autoscaler-status', 'cluster-autoscaler-priority-expander'],
        verbs: ['delete', 'get', 'update', 'watch'],
      },
    ],
  },
  { provider },
);

new k8s.rbac.v1.ClusterRoleBinding(
  'autoscaler-rbac-cluster-role-binding',
  {
    metadata: {
      labels,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: rbacClusterRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: sa.metadata.name,
        namespace,
      },
    ],
  },
  { provider },
);

new k8s.rbac.v1.RoleBinding(
  'autoscaler-rbac-role-binding',
  {
    metadata: {
      namespace,
      labels,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: rbacRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: sa.metadata.name,
        namespace,
      },
    ],
  },
  { provider },
);

const appLabels = {
  app: 'cluster-autoscaler',
};

new k8s.apps.v1.Deployment(
  'autoscaler',
  {
    metadata: {
      namespace,
      labels: appLabels,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: appLabels,
      },
      template: {
        metadata: {
          labels: appLabels,
          annotations: {
            'prometheus.io/scrape': 'true',
            'prometheus.io/port': '8085',
            'cluster-autoscaler.kubernetes.io/safe-to-evict': 'false',
          },
        },
        spec: {
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
          priorityClassName: 'system-cluster-critical',
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65534,
            fsGroup: 65534,
            seccompProfile: {
              type: 'RuntimeDefault',
            },
          },
          serviceAccountName: sa.metadata.name,
          volumes: [
            {
              name: 'ssl-certs',
              hostPath: {
                path: '/etc/ssl/certs/ca-bundle.crt',
              },
            },
          ],
          containers: [
            {
              image: 'registry.k8s.io/autoscaling/cluster-autoscaler:v1.28.0',
              name: 'cluster-autoscaler',
              resources: {
                limits: {
                  cpu: '100m',
                  memory: '600Mi',
                },
                requests: {
                  cpu: '100m',
                  memory: '600Mi',
                },
              },
              command: [
                './cluster-autoscaler',
                '--v=4',
                '--stderrthreshold=info',
                '--cloud-provider=aws',
                '--skip-nodes-with-local-storage=false',
                '--skip-nodes-with-system-pods=false',
                '--expander=least-waste',
                '--balance-similar-node-groups',
                `--node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled`,
                // TODO: add k8s.io/cluster-autoscaler/cluster=${clusterName} to restrict to EKS cluster
              ],
              volumeMounts: [
                {
                  name: 'ssl-certs',
                  mountPath: '/etc/ssl/certs/ca-certificates.crt',
                  readOnly: true,
                },
              ],
              imagePullPolicy: 'Always',
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: {
                  drop: ['ALL'],
                },
                readOnlyRootFilesystem: true,
              },
            },
          ],
        },
      },
    },
  },
  { provider },
);
