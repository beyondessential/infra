// The Kubernetes groups that may deploy Tamanu by hand, beside the automation that deploys it.
// Every binding of the deployer's permissions lists all of them, so that an engineer or an
// on-call can create a deployment with the same access as Tamanu CD. The `bes-guardrails` rule
// `deployer-bindings-include-people` fails a preview where a binding names the deployer and
// leaves one of them out.
// spec: K8SNSP#human-deployers
export const DEPLOYER_GROUP = 'tailscale:tamanu-deploy';

export const HUMAN_DEPLOYER_GROUPS = [
  'tailscale:engineer',
  // TODO: delete after 2026-05-01 once the old group name is fully retired
  'tailscale:tamanu-engineer',
  'tailscale:oncall',
] as const;

export const deployerSubjects = [DEPLOYER_GROUP, ...HUMAN_DEPLOYER_GROUPS].map((name) => ({
  kind: 'Group',
  name,
}));
