import * as k8s from '@pulumi/kubernetes';
import { serviceAccount } from './config.js';
import { namespace } from './namespace.js';

export const sa = serviceAccount
  ? new k8s.core.v1.ServiceAccount('app-sa', {
      metadata: {
        namespace,
        annotations: {
          'eks.amazonaws.com/role-arn': serviceAccount,
        },
      },
    })
  : null;
