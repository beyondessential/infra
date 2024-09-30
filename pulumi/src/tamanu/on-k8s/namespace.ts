import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/k8s/coreRef.js';
import { normalizedStack } from './config.js';

const name = cfg.get('namespace') ?? `tamanu-${normalizedStack}`;
if (name === 'system' || name === 'super') {
  throw new Error(`Namespace name ${name} is reserved`);
}

const ns = new k8s.core.v1.Namespace(
  `tamanu-${normalizedStack}`,
  {
    metadata: {
      name,
    },
  },
  { ignoreChanges: ['metadata.name'] },
);

export const namespace = ns.metadata.name;

new k8s.apiextensions.CustomResource(
  'parent-ns',
  {
    apiVersion: 'hnc.x-k8s.io/v1alpha2',
    kind: 'HierarchyConfiguration',
    metadata: {
      name: 'hierarchy',
      namespace,
    },
    spec: {
      parent: 'tamanu-super',
    },
  },
  { parent: ns },
);
