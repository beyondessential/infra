import type { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';

const VOLUME_NAME = 'blob-store';
const STORAGE_CLASS = 'efs';

// blobStorage.root is a database-backed setting that defaults to a path relative
// to the server's working directory, which is its package directory in the image.
// Mounting there means a deployment needs no setting to land on shared storage.
const DEFAULT_ROOT = {
  central: '/app/packages/central-server/data/blobs',
  facility: '/app/packages/facility-server/data/blobs',
};

export interface BlobStoreVolume {
  volume: k8s.types.input.core.v1.Volume;
  volumeMount: k8s.types.input.core.v1.VolumeMount;
}

export interface BlobStoreVolumeArgs {
  parent: ComponentResource;
  server: keyof typeof DEFAULT_ROOT;
}

export function blobStoreVolume(
  name: string,
  { parent, server }: BlobStoreVolumeArgs,
): BlobStoreVolume {
  const claim = new k8s.core.v1.PersistentVolumeClaim(
    `${name}-blobs`,
    {
      // Fixed name so a replacement collides instead of silently provisioning
      // a second, empty volume.
      metadata: { namespace, name: `${name}-blobs` },
      spec: {
        accessModes: ['ReadWriteMany'],
        storageClassName: STORAGE_CLASS,
        // EFS grows on demand and enforces no quota; the field is required.
        resources: { requests: { storage: '1Gi' } },
      },
    },
    { parent },
  );

  return {
    volume: {
      name: VOLUME_NAME,
      persistentVolumeClaim: { claimName: claim.metadata.name },
    },
    volumeMount: { name: VOLUME_NAME, mountPath: DEFAULT_ROOT[server] },
  };
}
