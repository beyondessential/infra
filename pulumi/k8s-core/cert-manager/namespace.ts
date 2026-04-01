import * as k8s from '@pulumi/kubernetes';
import { provider } from '../kubeconfig.ts';

const ns = new k8s.core.v1.Namespace('cert-manager', {
  metadata: {
    name: 'cert-manager',
  },
}, { provider });

export const namespace = ns.metadata.name;
