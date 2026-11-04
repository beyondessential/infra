import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { namespace } from './namespace.ts';
import { appEnvBlob, imagePullPat } from './config.ts';

// Blank lines and '#' comments are skipped. A line without '=' fails the
// preview rather than being dropped, which would surface only when a code
// location failed to start.
function parseDotenv(blob: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of blob.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new Error(`appEnvBlob: line has no '=': ${JSON.stringify(line)}`);
    }
    result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
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
