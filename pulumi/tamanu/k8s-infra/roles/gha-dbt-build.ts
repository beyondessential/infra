import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../superns.ts';

// Minimal role for GHA dbt-build: can only port-forward to pods.
// Note: K8s RBAC cannot restrict portforward to a specific port (e.g. 5432);
// that restriction is enforced by the absence of any other permissions.
const role = new k8s.rbac.v1.ClusterRole('tamanu-gha-dbt-build', {
  metadata: {
    name: 'tamanu-gha-dbt-build',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['pods', 'pods/portforward'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: [''],
      resources: ['pods/portforward'],
      verbs: ['create'],
    },
    {
      apiGroups: [''],
      resources: ['secrets'],
      verbs: ['get'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-super-gha-dbt-build', {
  metadata: {
    name: 'tamanu-gha-dbt-build',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:gha:dbt-build',
    },
  ],
});
