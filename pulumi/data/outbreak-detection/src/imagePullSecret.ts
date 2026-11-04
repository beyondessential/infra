import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { ghcrToken, ghcrUser } from './config.ts';
import { namespace } from './namespace.ts';

// The CronJob and Job manifests in disease-outbreak-detection reference this
// Secret by name (imagePullSecrets: [{name: 'ghcr-pull'}]) to pull the private
// ghcr.io/beyondessential/disease-outbreak-detection image.
export const pullSecretName = 'ghcr-pull';

export const pullSecret =
  ghcrUser && ghcrToken
    ? new k8s.core.v1.Secret(pullSecretName, {
        metadata: {
          name: pullSecretName,
          namespace,
        },
        type: 'kubernetes.io/dockerconfigjson',
        stringData: {
          '.dockerconfigjson': jsonStringify({
            auths: {
              'ghcr.io': {
                auth: ghcrToken.apply((pat) => Buffer.from(`${ghcrUser}:${pat}`).toString('base64')),
              },
            },
          }),
        },
      })
    : undefined;
