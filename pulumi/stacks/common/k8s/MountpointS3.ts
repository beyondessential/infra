import {
  ComponentResource,
  type Input,
  type Output,
  type ComponentResourceOptions,
  all,
  interpolate,
} from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { region } from './coreRef.ts';
import { compact } from 'lodash-es';

export interface MountpointS3Args {
  bucket: Input<string>;
  namespace: Input<string>;
  mode?: 'ReadWriteMany' | 'ReadOnlyMany';
  prefix?: Input<string | null>;
}

export class MountpointS3 extends ComponentResource {
  pv: k8s.core.v1.PersistentVolume;
  pvc: k8s.core.v1.PersistentVolumeClaim;
  claim: Output<string>;

  constructor(
    name: string,
    { bucket, namespace, mode = 'ReadWriteMany', prefix = null }: MountpointS3Args,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:common:MountpointS3', name, {}, opts);

    this.pv = new k8s.core.v1.PersistentVolume(`s3-pv-${name}`, {
      metadata: {
        name: `s3-pv-${name}`,
        namespace,
      },
      spec: {
        capacity: {
          storage: '1200Gi', // ignored, required
        },
        accessModes: [mode],
        storageClassName: '', // required to be empty
        claimRef: {
          // binds this PV to the PVC, so it can be rebound
          namespace,
          name: `s3-pvc-${name}`,
        },
        mountOptions: all([region, prefix]).apply(([region, prefix]) =>
          compact([
            mode === 'ReadOnlyMany' ? null : 'allow-delete',
            `region ${region}`,
            prefix && `prefix ${prefix}`,
          ]),
        ),
        csi: {
          driver: 's3.csi.aws.com', // Required
          volumeHandle: interpolate`s3-csi-driver-volume-${namespace}-${name}`, // Must be unique
          volumeAttributes: {
            bucketName: bucket,
          },
        },
      },
    });

    this.pvc = new k8s.core.v1.PersistentVolumeClaim(`s3-pvc-${name}`, {
      metadata: {
        name: `s3-pvc-${name}`,
        namespace,
      },
      spec: {
        accessModes: [mode],
        storageClassName: '', // required to be empty
        volumeName: this.pv.metadata.name,
        resources: {
          requests: {
            storage: '1200Gi', // ignored, required
          },
        },
      },
    });

    this.claim = this.pvc.metadata.name;
  }
}
