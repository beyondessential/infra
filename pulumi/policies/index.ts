import { PolicyPack, validateResourceOfType } from '@pulumi/policy';
import * as k8s from '@pulumi/kubernetes';

new PolicyPack('bes-k8s', {
  policies: [
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
