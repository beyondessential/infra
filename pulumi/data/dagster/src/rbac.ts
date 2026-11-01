import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// spec: K8SNSP#access-groups — "A group assigned to a GitHub Actions workflow
// MUST be named tailscale:gha: followed by the purpose" and "A binding of an
// access group to cluster-admin MUST be a RoleBinding" (never a
// ClusterRoleBinding). Same shape as tailscale:gha:canopy's own binding
// (canopy/src/gha-canopy.ts): cluster-admin, but scoped to this one namespace
// only by the RoleBinding, not cluster-wide.
//
// This grants the data-lake GHA workflow everything it needs to `pulumi up`
// this namespace's own resources (Helm release, Secrets, Ingress, …) with no
// AWS credentials — see K8SNSP#cluster-endpoint-access and dagster-irsa's own
// header comment for why that AWS-side role is a separate project instead.
//
// The other half of this — actually granting a tailnet identity the
// `tailscale:gha:dagster` tag/group — lives in the separate Tailscale ACL
// repo, not here; see the plan's "Tailnet ACL repo" item.
new k8s.rbac.v1.RoleBinding('gha-dagster', {
	metadata: { namespace },
	roleRef: {
		apiGroup: 'rbac.authorization.k8s.io',
		kind: 'ClusterRole',
		name: 'cluster-admin',
	},
	subjects: [
		{
			apiGroup: 'rbac.authorization.k8s.io',
			kind: 'Group',
			name: 'tailscale:gha:dagster',
		},
	],
});
