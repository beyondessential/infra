import * as k8s from '@pulumi/kubernetes';
import { argoNamespace } from '../../../common/k8s/argo.ts';
import { argoPlugin } from '../../../common/k8s/argoPlugin.ts';
import {
  CHANNELS,
  PLUGIN_VERSION,
  type Channel,
  UNKNOWN_CONFIG_KEYS_ENV,
  pluginBaseName,
  rendererImage,
  unknownConfigKeys,
} from '../../../common/tamanuRenderer.ts';

// What Tamanu deployments need from the shared Argo CD controller in
// k8s-essentials, which must be installed first: the plugin that renders them,
// the project they run under, and the access Tamanu CD needs to create them.

const namespaceName = argoNamespace;
const RENDER_REPO = 'https://github.com/beyondessential/infra';

// The renderer is published by that repository's CD, under a tag per channel that its promotion
// moves. A deployment is rendered by the channel its Application names, so each channel runs as
// a plugin of its own, from the same image at its own tag. The stable plugin's name is the one
// Applications have always used.
function pluginConfig(channel: Channel): string {
  return [
    'apiVersion: argoproj.io/v1alpha1',
    'kind: ConfigManagementPlugin',
    'metadata:',
    `  name: ${pluginBaseName(channel)}`,
    'spec:',
    `  version: ${PLUGIN_VERSION}`,
    '  generate:',
    '    command: [infra-argo-tamanu-renderer]',
    '    args: [--format, stream]',
    '',
  ].join('\n');
}

const plugins = CHANNELS.map((channel) =>
  argoPlugin({
    name: pluginBaseName(channel),
    image: rendererImage(channel),
    config: pluginConfig(channel),
    env: { [UNKNOWN_CONFIG_KEYS_ENV]: unknownConfigKeys(channel) },
    namespace: namespaceName,
  }),
);

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

// A promotion restarts the repo server, so that it serves the channel's new image, and then
// refreshes the Applications rendered by that channel. Through the same Tailscale proxy as
// Tamanu CD, under a group of its own, it can do those two things and nothing else.
// r[impl access.promotion-identity]
const promoteRole = new k8s.rbac.v1.Role('argo-renderer-promote', {
  metadata: { namespace: namespaceName },
  rules: [
    {
      apiGroups: ['argoproj.io'],
      resources: ['applications'],
      verbs: ['get', 'list', 'patch'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments'],
      verbs: ['get', 'watch', 'patch'],
      resourceNames: [plugins[0].metadata.name],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('argo-renderer-promote', {
  metadata: { namespace: namespaceName },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: promoteRole.metadata.name,
  },
  subjects: [{ kind: 'Group', name: 'tailscale:gha:renderer-promote' }],
});
