import * as k8s from '@pulumi/kubernetes';
import { name } from './config.ts';

const superNs = new k8s.core.v1.Namespace(
  `${name}-super`,
  {
    metadata: {
      name,
    },
  },
  { ignoreChanges: ['metadata.name'] },
);
const superNamespace = superNs.metadata.name;

const others = new Map();
for (const sub of ['system']) {
  const nsName = `${name}-${sub}`;
  const ns = new k8s.core.v1.Namespace(
    nsName,
    {
      metadata: {
        name: nsName,
      },
    },
    { ignoreChanges: ['metadata.name'] },
  );
  const namespace = ns.metadata.name;
  others.set(nsName, namespace);

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
        parent: superNamespace,
      },
    },
    { parent: superNs },
  );
}

export const system = others.get('system');
