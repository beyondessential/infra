import type { PolicyResource, StackValidationPolicy } from '@pulumi/policy';
import * as k8s from '@pulumi/kubernetes';

const READ_WRITE_ONCE = 'ReadWriteOnce';

// Policy inputs arrive wrapped in proxies, and the species lookup map/filter do
// trips their invariant, so array fields must be walked by index.
function claimNamesMountedBy(deployment: any): string[] {
  const volumes = deployment.spec?.template?.spec?.volumes ?? [];
  const names: string[] = [];
  for (let i = 0; i < volumes.length; i++) {
    const claimName = volumes[i]?.persistentVolumeClaim?.claimName;
    if (typeof claimName === 'string') names.push(claimName);
  }
  return names;
}

// Claims declared in this stack that more than one node can mount at once, and
// so can be rolled through without a multi-attach wait.
// spec: GRD#deployment-rollout-strategy
function sharedClaimNames(resources: PolicyResource[]): Set<string> {
  const shared = new Set<string>();
  for (const resource of resources) {
    const claim = resource.asType(k8s.core.v1.PersistentVolumeClaim) as any;
    const name = claim?.metadata?.name;
    const accessModes: string[] = claim?.spec?.accessModes ?? [];
    if (
      typeof name === 'string' &&
      accessModes.length > 0 &&
      !accessModes.includes(READ_WRITE_ONCE)
    ) {
      shared.add(name);
    }
  }
  return shared;
}

// spec: GRD#deployment-rollout-strategy
export const deploymentPvcNeedsRecreate: StackValidationPolicy = {
  name: 'deployment-pvc-needs-recreate',
  description:
    'Deployments that mount a ReadWriteOnce PersistentVolumeClaim must set spec.strategy.type = "Recreate" so rollouts do not hang on multi-attach. Claims a stack declares as ReadWriteMany are exempt; a claim declared elsewhere is treated as ReadWriteOnce.',
  enforcementLevel: 'mandatory',
  validateStack: (args, reportViolation) => {
    const shared = sharedClaimNames(args.resources);

    for (const resource of args.resources) {
      const deployment = resource.asType(k8s.apps.v1.Deployment) as any;
      if (!deployment) continue;

      const claimNames = claimNamesMountedBy(deployment).filter((name) => !shared.has(name));
      if (claimNames.length === 0) continue;

      const strategyType = deployment.spec?.strategy?.type;
      if (strategyType !== 'Recreate') {
        const shown = strategyType ?? 'RollingUpdate (default)';
        reportViolation(
          `Deployment mounts ReadWriteOnce PVC(s) [${claimNames.join(', ')}] but spec.strategy.type is '${shown}'. Set spec.strategy.type = 'Recreate' to avoid multi-attach rollout hangs.`,
          resource.urn,
        );
      }
    }
  },
};
