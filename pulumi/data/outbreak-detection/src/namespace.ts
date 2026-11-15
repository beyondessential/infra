import * as k8s from '@pulumi/kubernetes';
import { namespace as name } from './config.ts';

const ns = new k8s.core.v1.Namespace(name, {
  metadata: { name },
});

export const namespace = ns.metadata.name;
