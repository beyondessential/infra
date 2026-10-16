import * as k8s from '@pulumi/kubernetes';

export const controlPlaneLabels = {
  'control-plane': 'controller-manager',
};

export const ns = new k8s.core.v1.Namespace('hnc-system', {
  metadata: {
    labels: {
      ...controlPlaneLabels,
      'pod-security.kubernetes.io/enforce': 'restricted',
      'pod-security.kubernetes.io/enforce-version': 'v1.23',
    },
    name: 'hnc-system',
  },
});
export const namespace = ns.metadata.name;
