import * as k8s from '@pulumi/kubernetes';

// spec: K8SNSP#namespace-tree
const ns = new k8s.core.v1.Namespace('tamanu-super', {
  metadata: {
    name: 'tamanu-super',
  },
});

export const namespace = ns.metadata.name;
