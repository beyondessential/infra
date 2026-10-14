import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../../common/cfg.ts';
import { argoPlugin } from '../../../common/k8s/argoPlugin.ts';

// What Tamanu deployments need from the shared Argo CD controller in
// k8s-essentials, which must be installed first: the plugin that renders them,
// the project they run under, and the access Tamanu CD needs to create them.

const namespaceName = cfg.get('argoNamespace') ?? 'argocd';
const RENDER_REPO = 'https://github.com/beyondessential/infra';

// The renderer is published by that repository's CD. The tag is a required
// config value so the plugin never floats.
argoPlugin({
  name: 'infra-argo-tamanu-renderer',
  image: `ghcr.io/beyondessential/infra-argo-tamanu-renderer:${cfg.require('argoRenderImageTag')}`,
  namespace: namespaceName,
});

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
