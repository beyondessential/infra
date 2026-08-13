import type { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';

const VOLUME_NAME = 'blob-store';
const STORAGE_CLASS = 'efs';

// Must match the blobStorage.root setting the provisioning templates seed.
export const BLOB_STORE_ROOT = '/blobs';

// Where the default relative blobStorage.root lands: the image's workdir.
const DEFAULT_ROOT = {
  central: '/app/packages/central-server/data/blobs',
  facility: '/app/packages/facility-server/data/blobs',
};

export interface BlobStoreVolume {
  volume: k8s.types.input.core.v1.Volume;
  volumeMounts: k8s.types.input.core.v1.VolumeMount[];
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
    volumeMounts: [
      { name: VOLUME_NAME, mountPath: BLOB_STORE_ROOT },
      // A facility server boots before its settings sync down, so until then it
      // uses the default root.
      { name: VOLUME_NAME, mountPath: DEFAULT_ROOT[server] },
    ],
  };
}
