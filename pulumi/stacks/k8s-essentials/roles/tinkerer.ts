import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('tinker', {
  metadata: {
    name: 'tinker',
  },
});

const role = new k8s.rbac.v1.Role('tinkerer', {
  metadata: {
    name: 'tinkerer',
    namespace: namespace.metadata.name,
  },
  rules: [
    {
      apiGroups: [''],
      resources: [
        'pods',
        'pods/log',
        'pods/exec',
        'pods/portforward',
        'services',
        'endpoints',
        'secrets',
        'configmaps',
        'serviceaccounts',
        'persistentvolumeclaims',
        'events',
        'resourcequotas',
        'limitranges',
        'replicationcontrollers',
      ],
      verbs: ['*'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments', 'statefulsets', 'daemonsets', 'replicasets'],
      verbs: ['*'],
    },
    {
      apiGroups: ['batch'],
      resources: ['jobs', 'cronjobs'],
      verbs: ['*'],
    },
    {
      apiGroups: ['autoscaling'],
      resources: ['horizontalpodautoscalers'],
      verbs: ['*'],
    },
    {
      apiGroups: ['policy'],
      resources: ['poddisruptionbudgets'],
      verbs: ['*'],
    },
    {
      apiGroups: ['rbac.authorization.k8s.io'],
      resources: ['roles', 'rolebindings'],
      verbs: ['*'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['*'],
      verbs: ['*'],
    },
    {
      apiGroups: ['snapshot.storage.k8s.io'],
      resources: ['volumesnapshots'],
      verbs: ['*'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tinkerer', {
  metadata: {
    name: 'tinkerer',
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tinkerer',
    },
  ],
});

new k8s.core.v1.ResourceQuota('tinker-no-loadbalancers', {
  metadata: {
    name: 'no-loadbalancers',
    namespace: namespace.metadata.name,
  },
  spec: {
    hard: {
      'services.loadbalancers': '0',
      'services.nodeports': '0',
      'requests.storage': '100Gi',
      persistentvolumeclaims: '100',
      'count/clusters.postgresql.cnpg.io': '5',
    },
  },
});
