import * as k8s from '@pulumi/kubernetes';

export const ns = new k8s.core.v1.Namespace('postgres-restore-operator', {
  metadata: {
    name: 'postgres-restore-operator',
  },
});
export const namespace = ns.metadata.name;
