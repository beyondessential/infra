import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// The tamanu-seed namespace is standalone (not under tamanu-super/HNC), so the
// tamanu-deploy RoleBinding in tamanu-super does not propagate here.
// We bind in that namespace to the existing tamanu-deploy ClusterRole
// so that CI can create seed Jobs via the seed-snapshot workflow.

new k8s.rbac.v1.RoleBinding('tamanu-seed-deploy', {
  metadata: {
    name: 'tamanu-deploy',
    namespace,
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
