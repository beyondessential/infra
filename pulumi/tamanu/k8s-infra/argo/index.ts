import * as k8s from '@pulumi/kubernetes';
import { Config } from '@pulumi/pulumi';

// What Tamanu deployments need from the shared Argo CD controller in
// k8s-essentials, which must be installed first: the project they run under, and
// the access Tamanu CD needs to create them.

const argoCfg = new Config('argo');
const namespaceName = argoCfg.get('namespace') ?? 'argocd';
const RENDER_REPO = 'https://github.com/beyondessential/infra';

// Applications are limited to the render repository and to Tamanu deployment
// namespaces. `tamanu-meta-*` hold the version and meta servers and are not
// deployed this way. No cluster-scoped kind is allowed.
new k8s.apiextensions.CustomResource('argo-project-tamanu', {
  apiVersion: 'argoproj.io/v1alpha1',
  kind: 'AppProject',
  metadata: { name: 'tamanu', namespace: namespaceName },
  spec: {
    description: 'Tamanu deployments rendered by infra-argo-tamanu-renderer',
    sourceRepos: [RENDER_REPO],
    destinations: [
      { server: 'https://kubernetes.default.svc', namespace: 'tamanu-*' },
      { server: '*', namespace: '!tamanu-meta-*' },
    ],
    clusterResourceWhitelist: [],
  },
});

// Tamanu CD writes the Application for a deployment, through the same Tailscale
// identity it deploys with. It can do nothing else in this namespace.
const role = new k8s.rbac.v1.Role('argo-tamanu-deploy', {
  metadata: { name: 'tamanu-deploy', namespace: namespaceName },
  rules: [
    {
      apiGroups: ['argoproj.io'],
      resources: ['applications'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('argo-tamanu-deploy', {
  metadata: { name: 'tamanu-deploy', namespace: namespaceName },
  roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: role.metadata.name },
  subjects: [{ kind: 'Group', name: 'tailscale:tamanu-deploy' }],
});
