import * as k8s from '@pulumi/kubernetes';

// The tamanu-seed namespace is standalone (not under tamanu-super/HNC), so the
// tamanu-deploy RoleBinding in tamanu-super does not propagate here.
// We create the namespace and bind the existing tamanu-deploy ClusterRole
// so that CI can create seed Jobs via the seed-snapshot workflow.

const ns = new k8s.core.v1.Namespace('tamanu-seed', {
  metadata: {
    name: 'tamanu-seed',
  },
});

export const namespace = ns.metadata.name;

new k8s.rbac.v1.RoleBinding('tamanu-seed-deploy', {
  metadata: {
    name: 'tamanu-deploy',
    namespace: ns.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'tamanu-deploy',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    },
  ],
});
