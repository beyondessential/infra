import * as k8s from '@pulumi/kubernetes';

// t[impl namespace.exists+2]
export const namespace = new k8s.core.v1.Namespace('tinker-system', {
  metadata: {
    name: 'tinker-system',
  },
}).metadata.name;
