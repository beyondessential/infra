import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('tamanu-seed', {
  metadata: {
    name: 'tamanu-seed',
  },
});

export const namespace = ns.metadata.name;


