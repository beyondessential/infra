import * as k8s from '@pulumi/kubernetes';
import { normalizedStack } from './config.ts';

const ns = new k8s.core.v1.Namespace('namespace', {
  metadata: {
    name: `tamanu-replica-${normalizedStack}`,
  },
});
export const namespace = ns.metadata.name;
