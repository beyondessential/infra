import * as k8s from '@pulumi/kubernetes';
import { system } from './namespace.ts';
import { MountpointS3 } from '../../../common/k8s/MountpointS3.ts';
import { s3bucket } from './config.ts';

export const artifactsPVC = new MountpointS3('artifacts', {
  bucket: s3bucket,
  namespace: system,
  prefix: 'artifacts/',
}).claim;

export const logsPVC = new MountpointS3('logs', {
  bucket: s3bucket,
  namespace: system,
  prefix: 'logs/',
}).claim;

export const volumes: k8s.types.input.core.v1.Volume[] = [
  {
    name: 'artifacts',
    persistentVolumeClaim: {
      claimName: artifactsPVC,
    },
  },
  {
    name: 'logs',
    persistentVolumeClaim: {
      claimName: logsPVC,
    },
  },
];

export const volumeMounts: k8s.types.input.core.v1.VolumeMount[] = [
  {
    name: 'artifacts',
    mountPath: '/mnt/artifacts',
  },
  {
    name: 'logs',
    mountPath: '/mnt/logs',
  },
];
