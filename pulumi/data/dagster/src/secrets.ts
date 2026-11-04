import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import { appEnvBlob, imagePullPat } from './config.ts';

// Blank lines and '#' comments are skipped. A malformed line fails the preview
// rather than being dropped or overriding another, which would surface only
// when a code location failed to start or misbehaved.
function parseDotenv(blob: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [i, rawLine] of blob.split('\n').entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      // The line itself may be a secret, so only its position is reported.
      throw new Error(`appEnvBlob: line ${i + 1} has no '='`);
    }
    const key = line.slice(0, eq).trim();
    // The key names an entry of the Secret, which the API server restricts.
    if (!/^[-._a-zA-Z0-9]+$/.test(key) || key === '.' || key === '..') {
      throw new Error(`appEnvBlob: line ${i + 1} has an invalid key`);
    }
    if (key in result) {
      throw new Error(`appEnvBlob: line ${i + 1} repeats the key ${key}`);
    }
    result[key] = line.slice(eq + 1).trim();
  }
  return result;
}

// spec: DAGS#code-locations
// Holds only what the code locations read. The storage connection and the
// compute log bucket are chart values (helm.ts), not environment.
const envSecret = new k8s.core.v1.Secret('env', {
  metadata: { namespace },
  stringData: appEnvBlob.apply(parseDotenv),
});
export const envSecretName = envSecret.metadata.name;

export const registrySecret = imagePullPat
  ? new k8s.core.v1.Secret('registry', {
      metadata: { namespace },
      type: 'kubernetes.io/dockerconfigjson',
      stringData: {
        '.dockerconfigjson': jsonStringify({
          auths: {
            'https://ghcr.io': {
              auth: imagePullPat.apply((pat) =>
                Buffer.from(`beyondessential:${pat}`).toString('base64'),
              ),
            },
          },
        }),
      },
    })
  : undefined;
