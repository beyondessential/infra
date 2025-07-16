import * as k8s from '@pulumi/kubernetes';
import { system as namespace } from './namespace.ts';

export const sa = new k8s.core.v1.ServiceAccount('dagster', {
  metadata: { namespace },
  automountServiceAccountToken: false,
});
