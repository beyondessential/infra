import { getStack } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/k8s/coreRef.js';

const ns = new k8s.core.v1.Namespace(
  `tamanu-${getStack()}`,
  {
    metadata: {
      name: cfg.get('namespace'),
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
