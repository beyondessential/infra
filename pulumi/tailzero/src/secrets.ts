import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { border0InviteCode } from './config.ts';

export const secret = new k8s.core.v1.Secret('tailzero-secrets', {
  metadata: {
    namespace,
    name: 'tailzero-secrets',
  },
  stringData: {
    BORDER0_INVITE_CODE: border0InviteCode,
  },
});
