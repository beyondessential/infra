import * as k8s from '@pulumi/kubernetes';

export const ns = new k8s.core.v1.Namespace('pgro-system', {
  metadata: {
    name: 'pgro-system',
  },
});
export const namespace = ns.metadata.name;
