import * as k8s from '@pulumi/kubernetes';
import { Config } from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';

const pgsnapCfg = new Config('pgsnap');
const imageTag = pgsnapCfg.get('imageTag');

if (imageTag) {
  const image = `ghcr.io/beyondessential/pgsnap:${imageTag}`;

  const labels = {
    'app.kubernetes.io/name': 'pgsnap',
    'app.kubernetes.io/component': 'operator',
  };

  const sa = new k8s.core.v1.ServiceAccount('pgsnap-operator', {
    metadata: {
      namespace,
    },
  });

  const role = new k8s.rbac.v1.Role('pgsnap-operator', {
    metadata: {
      namespace,
    },
    rules: [
      {
        apiGroups: ['batch'],
        resources: ['jobs'],
        verbs: ['get', 'list', 'watch', 'patch'],
      },
      {
        apiGroups: ['postgresql.cnpg.io'],
        resources: ['clusters'],
        verbs: ['get', 'list', 'create', 'delete'],
      },
      {
        apiGroups: [''],
        resources: ['endpoints'],
        verbs: ['get', 'list', 'watch'],
      },
      {
        apiGroups: [''],
        resources: ['secrets'],
        verbs: ['get', 'create', 'delete'],
      },
      {
        apiGroups: ['snapshot.storage.k8s.io'],
        resources: ['volumesnapshots'],
        verbs: ['get', 'list', 'create', 'delete'],
      },
      {
        apiGroups: [''],
        resources: ['events'],
        verbs: ['create'],
      },
    ],
  });

  new k8s.rbac.v1.RoleBinding('pgsnap-operator', {
    metadata: {
      namespace,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: role.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: sa.metadata.name,
        namespace,
      },
    ],
  });

  new k8s.apps.v1.Deployment('pgsnap-operator', {
    metadata: {
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: sa.metadata.name,
          tolerations: [CAN_RUN_ON_SPOT],
          affinity: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 1, preference: RUN_ON_SPOT },
              ],
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: [
                      purposeAffinity('workload'),
                      archAffinity('arm64'),
                    ],
                  },
                ],
              },
            },
          },
          containers: [
            {
              name: 'operator',
              image,
              env: [
                { name: 'RUST_LOG', value: 'pgsnap=info,kube=info' },
              ],
              ports: [{ containerPort: 8080, name: 'health' }],
              livenessProbe: {
                httpGet: { path: '/livez', port: 'health' },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: { path: '/readyz', port: 'health' },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              resources: {
                requests: { cpu: '10m', memory: '64Mi' },
                limits: { memory: '128Mi' },
              },
            },
          ],
        },
      },
    },
  });

  new k8s.core.v1.Service('pgsnap-operator', {
    metadata: {
      namespace,
    },
    spec: {
      type: 'ClusterIP',
      selector: labels,
      ports: [{ port: 8080, targetPort: 'health', name: 'health' }],
    },
  });
}
