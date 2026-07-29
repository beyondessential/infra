import type { ResourceValidationPolicy } from '@pulumi/policy';

export const GUARDDUTY_OWNER_PROJECT = 'security-monitoring';

// urn:pulumi:<stack>::<project>::<type>::<name>
export const projectFromUrn = (urn: string): string | undefined => urn.split('::')[1];

export const guarddutySingleOwner: ResourceValidationPolicy = {
  name: 'guardduty-single-owner',
  description: `Only the ${GUARDDUTY_OWNER_PROJECT} project may declare GuardDuty resources. The delegated administrator, detector and organization configuration are singletons per region, and Pulumi has no cross-stack ownership check: a second stack importing them shares them silently, then disassociates every member account when it is destroyed.`,
  enforcementLevel: 'mandatory',
  validateResource: (args, reportViolation) => {
    if (!args.type.startsWith('aws:guardduty/')) return;
    const project = projectFromUrn(args.urn);
    if (project !== GUARDDUTY_OWNER_PROJECT) {
      reportViolation(
        `${args.type} is declared in project '${project ?? 'unknown'}'. GuardDuty resources belong only to '${GUARDDUTY_OWNER_PROJECT}'.`,
      );
    }
  },
};
