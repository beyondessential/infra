import * as k8s from '@pulumi/kubernetes';
import { Output } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';
import { normalizedStack } from './config.ts';

const name = cfg.get('namespace') ?? `tamanu-${normalizedStack}`;
if (name === 'system' || name === 'super') {
  throw new Error(`Namespace name ${name} is reserved`);
}

// When true, assumes the namespace was created externally (e.g., by GitHub Actions
// via SubnamespaceAnchor) and HNC manages the parent relationship.
// Pulumi will reference the existing namespace without managing its lifecycle.
const externalNamespace = cfg.getBoolean('externalNamespace') ?? false;

function setupNamespace(): Output<string> {
  if (externalNamespace) {
    // Namespace created externally via SubnamespaceAnchor in tamanu-super.
    // Use get() to reference it without managing its lifecycle.
    const ns = k8s.core.v1.Namespace.get(`tamanu-${normalizedStack}`, name);
    return ns.metadata.name;
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
