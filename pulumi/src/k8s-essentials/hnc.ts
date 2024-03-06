// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { interpolate } from '@pulumi/pulumi';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../common/k8s/affinities.js';

const HNC_VERSION = '1.1.0';
const controlPlaneLabels = {
  'control-plane': 'controller-manager',
};

const ns = new k8s.core.v1.Namespace('hnc-system', {
  metadata: {
    labels: {
      ...controlPlaneLabels,
      'pod-security.kubernetes.io/enforce': 'restricted',
      'pod-security.kubernetes.io/enforce-version': 'v1.23',
    },
    name: 'hnc-system',
  },
});
const namespace = ns.metadata.name;

const leaderElectionRole = new k8s.rbac.v1.Role(
  'hnc-leader-election-role',
  {
    metadata: {
      name: 'hnc-leader-election-role',
      namespace,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['configmaps'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      {
        apiGroups: [''],
        resources: ['configmaps/status'],
        verbs: ['get', 'update', 'patch'],
      },
      {
        apiGroups: [''],
        resources: ['events'],
        verbs: ['create'],
      },
    ],
  },
  { parent: ns },
);

export const adminRole = new k8s.rbac.v1.ClusterRole(
  'hnc-admin-role',
  {
    metadata: {
      labels: {
        'rbac.authorization.k8s.io/aggregate-to-admin': 'true',
      },
      name: 'hnc-admin-role',
    },
    rules: [
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['*'],
        verbs: ['*'],
      },
    ],
  },
  { parent: ns },
);

const managerRole = new k8s.rbac.v1.ClusterRole(
  'hnc-manager-role',
  {
    metadata: {
      creationTimestamp: 'null',
      name: 'hnc-manager-role',
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['resourcequotas'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['*'],
        resources: ['*'],
        verbs: ['*'],
      },
      {
        apiGroups: [''],
        resources: ['namespaces'],
        verbs: ['get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchicalresourcequotas'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchicalresourcequotas/status'],
        verbs: ['get', 'patch', 'update'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchies'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchies/status'],
        verbs: ['get', 'patch', 'update'],
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.RoleBinding(
  'hnc-leader-election-rolebinding',
  {
    metadata: {
      name: 'hnc-leader-election-rolebinding',
      namespace,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: leaderElectionRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: 'default',
        namespace,
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.ClusterRoleBinding(
  'hnc-manager-rolebinding',
  {
    metadata: {
      name: 'hnc-manager-rolebinding',
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: managerRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: 'default',
        namespace,
      },
    ],
  },
  { parent: ns },
);

new k8s.core.v1.Service(
  'hnc-controller-manager-metrics-service',
  {
    metadata: {
      annotations: {
        'prometheus.io/port': '8080',
        'prometheus.io/scheme': 'http',
        'prometheus.io/scrape': 'true',
      },
      labels: controlPlaneLabels,
      name: 'hnc-controller-manager-metrics-service',
      namespace,
    },
    spec: {
      ports: [
        {
          name: 'metrics',
          port: 8080,
          targetPort: 'metrics',
        },
      ],
      selector: controlPlaneLabels,
    },
  },
  { parent: ns },
);

const webhookService = new k8s.core.v1.Service(
  'hnc-webhook-service',
  {
    metadata: {
      name: 'hnc-webhook-service',
      namespace,
    },
    spec: {
      ports: [
        {
          port: 443,
          targetPort: 9443,
        },
      ],
      selector: controlPlaneLabels,
    },
  },
  { parent: ns },
);

new k8s.apps.v1.Deployment(
  'hnc-controller-manager',
  {
    metadata: {
      labels: controlPlaneLabels,
      name: 'hnc-controller-manager',
      namespace,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: controlPlaneLabels,
      },
      template: {
        metadata: {
          annotations: {
            'prometheus.io/scrape': 'true',
          },
          labels: controlPlaneLabels,
        },
        spec: {
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
                    // No ARM64 support: https://github.com/kubernetes-sigs/hierarchical-namespaces/issues/201
                    matchExpressions: [archAffinity('amd64'), purposeAffinity('system')],
                  },
                ],
              },
            },
          },
          containers: [
            {
              args: [
                '--webhook-server-port=9443',
                '--metrics-addr=:8080',
                '--max-reconciles=10',
                '--apiserver-qps-throttle=50',
                '--excluded-namespace=kube-system',
                '--excluded-namespace=kube-public',
                '--excluded-namespace=hnc-system',
                '--excluded-namespace=kube-node-lease',
                '--nopropagation-label=cattle.io/creator=norman',
              ],
              command: ['/manager'],
              image: `gcr.io/k8s-staging-multitenancy/hnc-manager:v${HNC_VERSION}`,
              livenessProbe: {
                failureThreshold: 1,
                httpGet: {
                  path: '/healthz',
                  port: 8081,
                },
                periodSeconds: 10,
              },
              name: 'manager',
              ports: [
                {
                  containerPort: 9443,
                  name: 'webhook-server',
                  protocol: 'TCP',
                },
                {
                  containerPort: 8080,
                  name: 'metrics',
                  protocol: 'TCP',
                },
                {
                  containerPort: 8081,
                  name: 'healthz',
                  protocol: 'TCP',
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: '/readyz',
                  port: 8081,
                },
                periodSeconds: 5,
              },
              resources: {
                limits: {
                  cpu: '100m',
                  memory: '300Mi',
                },
                requests: {
                  cpu: '100m',
                  memory: '150Mi',
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: {
                  drop: ['ALL'],
                },
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
                seccompProfile: {
                  type: 'RuntimeDefault',
                },
              },
              startupProbe: {
                failureThreshold: 100,
                httpGet: {
                  path: '/readyz',
                  port: 8081,
                },
                periodSeconds: 5,
              },
              volumeMounts: [
                {
                  mountPath: '/tmp/k8s-webhook-server/serving-certs',
                  name: 'cert',
                  readOnly: true,
                },
              ],
            },
          ],
          securityContext: {
            fsGroup: 2000,
            runAsNonRoot: true,
            runAsUser: 1000,
          },
          terminationGracePeriodSeconds: 10,
          volumes: [
            {
              name: 'cert',
              secret: {
                defaultMode: 420,
                secretName: 'webhook-server-cert',
              },
            },
          ],
        },
      },
    },
  },
  { parent: ns },
);

const issuer = new k8s.apiextensions.CustomResource(
  'hnc-issuer',
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Issuer',
    metadata: {
      namespace,
    },
    spec: {
      selfSigned: {},
    },
  },
  { parent: ns },
);

const servingCert = new k8s.apiextensions.CustomResource(
  'hnc-serving-cert',
  {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: {
      namespace,
    },
    spec: {
      commonName: 'hnc-webhook-service.hnc-system.svc',
      dnsNames: [
        'hnc-webhook-service.hnc-system.svc.cluster.local',
        'hnc-webhook-service.hnc-system.svc',
      ],
      issuerRef: {
        kind: 'Issuer',
        name: issuer.metadata.name,
      },
      secretName: 'webhook-server-cert',
    },
  },
  { parent: ns },
);

new k8s.admissionregistration.v1.MutatingWebhookConfiguration(
  'hnc-mutating-webhook-configuration',
  {
    metadata: {
      annotations: {
        'cert-manager.io/inject-ca-from': interpolate`${namespace}/${servingCert.metadata.name}`,
      },
      name: 'hnc-mutating-webhook-configuration',
    },
    webhooks: [
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/mutate-namespace',
          },
        },
        failurePolicy: 'Ignore',
        name: 'namespacelabel.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: [''],
            apiVersions: ['v1'],
            operations: ['CREATE', 'UPDATE'],
            resources: ['namespaces'],
          },
        ],
        sideEffects: 'None',
      },
    ],
  },
  { parent: ns },
);

new k8s.admissionregistration.v1.ValidatingWebhookConfiguration(
  'hnc-validating-webhook-configuration',
  {
    metadata: {
      annotations: {
        'cert-manager.io/inject-ca-from': interpolate`${namespace}/${servingCert.metadata.name}`,
      },
      name: 'hnc-validating-webhook-configuration',
    },
    webhooks: [
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-subnamespaceanchors',
          },
        },
        failurePolicy: 'Fail',
        name: 'subnamespaceanchors.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['subnamespaceanchors'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-hierarchyconfigurations',
          },
        },
        failurePolicy: 'Fail',
        name: 'hierarchyconfigurations.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE'],
            resources: ['hierarchyconfigurations'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-objects',
          },
        },
        failurePolicy: 'Fail',
        name: 'objects.hnc.x-k8s.io',
        namespaceSelector: {
          matchLabels: {
            'hnc.x-k8s.io/included-namespace': 'true',
          },
        },
        rules: [
          {
            apiGroups: ['*'],
            apiVersions: ['*'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['*'],
            scope: 'Namespaced',
          },
        ],
        sideEffects: 'None',
        timeoutSeconds: 2,
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-hnc-x-k8s-io-v1alpha2-hncconfigurations',
          },
        },
        failurePolicy: 'Fail',
        name: 'hncconfigurations.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: ['hnc.x-k8s.io'],
            apiVersions: ['v1alpha2'],
            operations: ['CREATE', 'UPDATE', 'DELETE'],
            resources: ['hncconfigurations'],
          },
        ],
        sideEffects: 'None',
      },
      {
        admissionReviewVersions: ['v1'],
        clientConfig: {
          service: {
            name: webhookService.metadata.name,
            namespace,
            path: '/validate-v1-namespace',
          },
        },
        failurePolicy: 'Fail',
        name: 'namespaces.hnc.x-k8s.io',
        rules: [
          {
            apiGroups: [''],
            apiVersions: ['v1'],
            operations: ['DELETE', 'CREATE', 'UPDATE'],
            resources: ['namespaces'],
          },
        ],
        sideEffects: 'None',
      },
    ],
  },
  { parent: ns },
);
