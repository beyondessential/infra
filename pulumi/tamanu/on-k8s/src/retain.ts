import * as k8s from '@pulumi/kubernetes';
import { CustomResource, type Resource, runtime } from '@pulumi/pulumi';

// Release 1 of the move to Argo CD: every resource this program creates is marked
// retain-on-delete in state, so the next release can drop them from state without
// touching the cluster. This module must be imported before anything that creates
// resources, since the transformation applies only to resources created after it.

// Cluster-scoped, so deleting the namespace would not remove it.
const CLUSTER_SCOPED_KINDS = new Set(['VolumeSnapshotContent']);

const retained: Resource[] = [];

runtime.registerStackTransformation(({ resource, type, props, opts }) => {
  if (
    !(resource instanceof CustomResource) ||
    type.startsWith('pulumi:') ||
    opts.id !== undefined ||
    CLUSTER_SCOPED_KINDS.has(props.kind)
  ) {
    return undefined;
  }
  retained.push(resource);
  return { props, opts: { ...opts, retainOnDelete: true } };
});

// Written last, depending on everything else, so that it exists only once an update has
// completed with every resource marked.
export function markRetained(namespace: string): void {
  new k8s.core.v1.ConfigMap(
    'migration',
    {
      metadata: { name: 'migration', namespace },
      data: { phase: 'retained' },
    },
    { dependsOn: [...retained] },
  );
}
