import * as k8s from '@pulumi/kubernetes';

// spec: K8SNSP#oncall
const role = new k8s.rbac.v1.ClusterRole('oncall', {
  metadata: {
    name: 'oncall',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['nodes', 'namespaces', 'persistentvolumes'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: [''],
      resources: [
        'pods',
        'pods/log',
        'pods/exec',
        'pods/portforward',
        'services',
        'endpoints',
        'configmaps',
        'secrets',
        'serviceaccounts',
        'persistentvolumeclaims',
        'events',
      ],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments', 'statefulsets', 'daemonsets', 'replicasets'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['batch'],
      resources: ['jobs', 'cronjobs'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses', 'networkpolicies'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['hnc.x-k8s.io'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
    {
      apiGroups: ['bes.au'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['rbac.authorization.k8s.io'],
      resources: ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['cert-manager.io'],
      resources: ['certificates', 'certificaterequests', 'issuers', 'clusterissuers'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['snapshot.storage.k8s.io'],
      resources: ['volumesnapshots', 'volumesnapshotcontents'],
      verbs: ['get', 'list', 'watch', 'create', 'delete'],
    },
    {
      apiGroups: ['gateway.networking.k8s.io'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['gateway.envoyproxy.io'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['autoscaling'],
      resources: ['horizontalpodautoscalers'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['apiextensions.k8s.io'],
      resources: ['customresourcedefinitions'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('oncall', {
  metadata: {
    name: 'oncall',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:oncall',
    },
  ],
});
