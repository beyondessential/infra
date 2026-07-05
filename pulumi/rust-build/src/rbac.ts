import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { accessGroup } from './config.ts';

// Namespace-scoped access for builder *users*, modelled on the `tinker` stack
// (k8s-essentials/tinker/role.ts). Deliberately its own group rather than
// borrowing `oncall`: the Tailscale ACL grant that populates `accessGroup`
// (default tailscale:rust-build) is managed Tailscale-side.
//
// Just enough to drive the builders: claim/renew slot Leases, scale the
// StatefulSets, and exec/rsync into the builder pods.
const role = new k8s.rbac.v1.Role('rust-build-user', {
  metadata: { namespace },
  rules: [
    {
      apiGroups: ['coordination.k8s.io'],
      resources: ['leases'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
    {
      apiGroups: [''],
      resources: ['pods', 'pods/log'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: [''],
      resources: ['pods/exec'],
      verbs: ['create'],
    },
    {
      apiGroups: ['apps'],
      resources: ['statefulsets', 'statefulsets/scale'],
      verbs: ['get', 'list', 'watch', 'update', 'patch'],
    },
    {
      apiGroups: [''],
      resources: ['persistentvolumeclaims'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('rust-build-user', {
  metadata: { namespace },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: role.metadata.name,
  },
  subjects: [{ kind: 'Group', name: accessGroup }],
});
