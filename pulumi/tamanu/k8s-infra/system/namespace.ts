import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('tamanu-system', {
  metadata: {
    name: 'tamanu-system',
  },
});

export const namespace = ns.metadata.name;
