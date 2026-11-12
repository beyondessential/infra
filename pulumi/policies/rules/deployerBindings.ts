import type { PolicyResource, StackValidationPolicy } from '@pulumi/policy';
import * as k8s from '@pulumi/kubernetes';

const DEPLOYER_GROUP = 'tailscale:tamanu-deploy';
const HUMAN_DEPLOYER_GROUPS = [
  'tailscale:engineer',
  'tailscale:tamanu-engineer',
  'tailscale:oncall',
];

// Policy inputs arrive wrapped in proxies, so array fields are walked by index.
function groupNames(binding: any): Set<string> {
  const names = new Set<string>();
  const subjects = binding.subjects ?? [];
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i];
    if (subject?.kind === 'Group' && typeof subject.name === 'string') names.add(subject.name);
  }
  return names;
}

function bindingOf(resource: PolicyResource): any {
  return (
    resource.asType(k8s.rbac.v1.RoleBinding) ?? resource.asType(k8s.rbac.v1.ClusterRoleBinding)
  );
}

// spec: K8SNSP#human-deployers
export const deployerBindingsIncludePeople: StackValidationPolicy = {
  name: 'deployer-bindings-include-people',
  description: `A RoleBinding or ClusterRoleBinding that names the deployer group '${DEPLOYER_GROUP}' must also name ${HUMAN_DEPLOYER_GROUPS.map((g) => `'${g}'`).join(', ')}, so that engineers and on-calls can deploy Tamanu by hand with the access Tamanu CD has.`,
  enforcementLevel: 'mandatory',
  validateStack: (args, reportViolation) => {
    for (const resource of args.resources) {
      const binding = bindingOf(resource);
      if (!binding) continue;

      const names = groupNames(binding);
      if (!names.has(DEPLOYER_GROUP)) continue;

      const missing = HUMAN_DEPLOYER_GROUPS.filter((group) => !names.has(group));
      if (missing.length > 0) {
        reportViolation(
          `Binding names the deployer group '${DEPLOYER_GROUP}' but not [${missing.join(', ')}]. Engineers and on-calls would be unable to deploy Tamanu by hand, so name every group of the deployer in the binding.`,
          resource.urn,
        );
      }
    }
  },
};
