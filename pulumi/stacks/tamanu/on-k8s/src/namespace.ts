import * as k8s from '@pulumi/kubernetes';
import { Output } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';
import { normalizedStack } from './config.ts';

const name = cfg.get('namespace') ?? `tamanu-${normalizedStack}`;
if (name === 'system' || name === 'super') {
  throw new Error(`Namespace name ${name} is reserved`);
}

// When true, assumes the namespace was created externally (e.g., by GitHub Actions
// via SubnamespaceAnchor). When false (default), Pulumi manages namespace lifecycle.
const externalNamespace = cfg.getBoolean('externalNamespace') ?? false;

function setupNamespace(): Output<string> {
  if (externalNamespace) {
    // Namespace created externally via SubnamespaceAnchor in tamanu-super.
    // HNC automatically sets up the parent relationship, so we just reference it.
    return Output.create(name);
  }

  // Pulumi manages the namespace directly.
  // Create the namespace and set up HNC parent relationship.
  const ns = new k8s.core.v1.Namespace(
    `tamanu-${normalizedStack}`,
    {
      metadata: {
        name,
      },
    },
    { ignoreChanges: ['metadata.name'] },
  );

  new k8s.apiextensions.CustomResource(
    'hnc-parent',
    {
      apiVersion: 'hnc.x-k8s.io/v1alpha2',
      kind: 'HierarchyConfiguration',
      metadata: {
        name: 'hierarchy',
        namespace: ns.metadata.name,
      },
      spec: {
        parent: 'tamanu-super',
      },
    },
    { parent: ns },
  );

  return ns.metadata.name;
}

export const namespace = setupNamespace();
