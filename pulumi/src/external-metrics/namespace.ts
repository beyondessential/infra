import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('metrics-external', {
  metadata: {
    name: 'metrics-external',
  },
});

export const namespace = ns.metadata.name;
