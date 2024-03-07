import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('tamanu-super', {
  metadata: {
    name: 'tamanu-super',
  },
});

new k8s.rbac.v1.ClusterRoleBinding('tailscale-tamanu-deploy-read', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'read',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    }
  ],
});

// TODO
// new k8s.rbac.v1.ClusterRoleBinding('tailscale-tamanu-deploy-createns', {
//   roleRef: {
//     apiGroup: 'rbac.authorization.k8s.io',
//     kind: 'ClusterRole',
//     name: 'read',
//   },
//   subjects: [
//     {
//       kind: 'Group',
//       name: 'tailscale:tamanu-deploy',
//     }
//   ],
// });
