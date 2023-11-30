import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('metrics', {
  metadata: {
    name: 'metrics',
  },
});

export const namespace = ns.metadata.name;
