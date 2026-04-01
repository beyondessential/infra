import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import {
  accessKeyId,
  bucket,
  bucketRegion,
  repositoryPassword,
  secretAccessKey,
} from './config.ts';

export const secret = new k8s.core.v1.Secret('kopia', {
  metadata: {
    namespace,
  },
  stringData: {
    accessKeyId,
    bucket,
    region: bucketRegion,
    repositoryPassword,
    secretAccessKey,
  },
});
