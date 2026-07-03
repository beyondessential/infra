import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/k8s/coreRef.ts';
import { normalizedStack } from './config.ts';

const name = cfg.get('namespace') ?? normalizedStack;

const ns = new k8s.core.v1.Namespace(
  normalizedStack,
  {
    metadata: {
      name,
    },
  },
  { ignoreChanges: ['metadata.name'] },
);

export const namespace = ns.metadata.name;
