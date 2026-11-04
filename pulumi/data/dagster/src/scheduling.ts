import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';

// spec: DAGS#run-launcher
// For the long-lived pods: the webserver, the daemon and the code servers.
// The data-lake image is built for amd64 only, and run pods (helm.ts) are
// pinned to amd64 by their node selector.
export const SPOT_PREFERRED_AFFINITY = {
  nodeAffinity: {
    preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
    requiredDuringSchedulingIgnoredDuringExecution: {
      nodeSelectorTerms: [
        { matchExpressions: [purposeAffinity('workload'), archAffinity('amd64')] },
      ],
    },
  },
};
export const SPOT_TOLERATIONS = [CAN_RUN_ON_SPOT];
