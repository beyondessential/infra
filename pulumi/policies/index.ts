import { PolicyPack, validateResourceOfType } from '@pulumi/policy';
import * as k8s from '@pulumi/kubernetes';

// urn:pulumi:<stack>::<project>::<type>::<name>
const projectFromUrn = (urn: string): string | undefined => urn.split('::')[1];

const GUARDDUTY_OWNER_PROJECT = 'security-monitoring';

new PolicyPack('bes-k8s', {
  policies: [
    {
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
    },
    {
      name: 'deployment-pvc-needs-recreate',
      description:
        'Deployments that mount a PersistentVolumeClaim must set spec.strategy.type = "Recreate" so RWO-PVC rollouts do not hang on multi-attach.',
      enforcementLevel: 'mandatory',
      validateResource: validateResourceOfType(
        k8s.apps.v1.Deployment,
        (deployment, _args, reportViolation) => {
          const volumes = deployment.spec?.template?.spec?.volumes ?? [];
          const claimNames: string[] = [];
          for (const v of volumes) {
            const n = (v as any)?.persistentVolumeClaim?.claimName;
            if (typeof n === 'string') claimNames.push(n);
          }
          if (claimNames.length === 0) return;
          const strategyType = deployment.spec?.strategy?.type;
          if (strategyType !== 'Recreate') {
            const shown = strategyType ?? 'RollingUpdate (default)';
            reportViolation(
              `Deployment mounts PVC(s) [${claimNames.join(', ')}] but spec.strategy.type is '${shown}'. Set spec.strategy.type = 'Recreate' to avoid multi-attach rollout hangs on ReadWriteOnce volumes.`,
            );
          }
        },
      ),
    },
  ],
});
