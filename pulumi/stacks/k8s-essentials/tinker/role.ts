import * as k8s from '@pulumi/kubernetes';

// t[impl namespace.exists+2]
const namespace = new k8s.core.v1.Namespace('tinker', {
  metadata: {
    name: 'tinker',
  },
}).metadata.name;

// t[impl namespace.rbac.role]
const role = new k8s.rbac.v1.Role('tinkerer', {
  metadata: {
    namespace,
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
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses'],
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

// t[impl namespace.rbac.binding]
new k8s.rbac.v1.RoleBinding('tinkerer', {
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
      kind: 'Group',
      name: 'tailscale:tinkerer',
    },
  ],
});

// t[impl namespace.admission.ingress-class]
// t[impl namespace.admission.ingress-prefix]
const admissionPolicy = new k8s.admissionregistration.v1.ValidatingAdmissionPolicy(
  'tinker-tailscale-ingress-only',
  {
    spec: {
      failurePolicy: 'Fail',
      matchConstraints: {
        resourceRules: [
          {
            apiGroups: ['networking.k8s.io'],
            apiVersions: ['v1'],
            operations: ['CREATE', 'UPDATE'],
            resources: ['ingresses'],
          },
        ],
        namespaceSelector: {
          matchLabels: {
            'kubernetes.io/metadata.name': 'tinker',
          },
        },
      },
      validations: [
        {
          expression: 'object.spec.ingressClassName == "tailscale"',
          message: 'Only tailscale ingresses are allowed in the tinker namespace.',
        },
        {
          expression:
            'has(object.spec.tls) && object.spec.tls.size() > 0 && object.spec.tls[0].hosts.size() > 0 && object.spec.tls[0].hosts[0].startsWith("tinker-")',
          message: 'Ingress tls.hosts[0] in the tinker namespace must be prefixed with "tinker-".',
        },
      ],
    },
  },
);

new k8s.admissionregistration.v1.ValidatingAdmissionPolicyBinding('tinker-tailscale-ingress-only', {
  spec: {
    policyName: admissionPolicy.metadata.name,
    validationActions: ['Deny'],
  },
});

// t[impl namespace.quotas]
new k8s.core.v1.ResourceQuota('tinker-no-loadbalancers', {
  metadata: {
    namespace,
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
