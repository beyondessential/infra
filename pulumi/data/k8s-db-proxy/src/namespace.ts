import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('namespace', {
  metadata: { name: 'db-proxy' },
});
export const namespace = ns.metadata.name;
