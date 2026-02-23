import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import { secret } from './kopia.ts';
import {
  minimumTtl,
  persistentSchemas,
  schedule,
  snapshotFilter,
  storageSizeMaximum,
} from './config.ts';
import { namespace } from './namespace.ts';

new k8s.apiextensions.CustomResource('replica', {
  apiVersion: 'pgro.bes.au/v1alpha1',
  kind: 'PostgresPhysicalReplica',
  metadata: {
    name: 'replica',
    namespace,
    annotations: {
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    kopiaSecretRef: {
      name: secret.metadata.name,
    },
    minimumTtl,
    schedule,
    scheduleJitter: '2m', // one minute either side
    snapshotFilter,
    storageClass: 'ebs-gp3',
    // how long the old restore stays alive once the new one has been set up
    switchoverGracePeriod: '2m',
    persistentSchemas,
    storageSizeMaximum,
    serviceAnnotations: {
      'tailscale.com/expose': 'true',
    },
  },
});
