import * as k8s from '@pulumi/kubernetes';
import { name } from './config.ts';

const ns = new k8s.core.v1.Namespace(
  name,
  {
    metadata: { name },
  },
  { ignoreChanges: ['metadata.name'] },
);

export const namespace = ns.metadata.name;
