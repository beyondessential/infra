import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { region } from '../../common/awsAccount.ts';
import { provider } from '../kubeconfig.ts';
import { cfg } from '../../common/coreRef.ts';
import { certManager } from './controller.ts';

const kid = cfg.get('zerosslEabKid');
if (kid) {
  const key = cfg.requireSecret('zerosslEabKey');

  const secret = new k8s.core.v1.Secret(
    'zerossl-eab',
    {
      metadata: {
        namespace,
      },
      stringData: {
        kid,
        key,
      },
    },
    { provider },
  );

  new k8s.apiextensions.CustomResource(
    'zerossl',
    {
      apiVersion: 'cert-manager.io/v1',
      kind: 'ClusterIssuer',
      // no namespace: ClusterIssuer is cluster-scoped
      metadata: {
        name: 'zerossl',
      },
      spec: {
        acme: {
          server: 'https://acme.zerossl.com/v2/DV90',
          email: 'tls-renewal@bes.au',
          privateKeySecretRef: {
            name: 'zerossl',
          },
          externalAccountBinding: {
            keyID: kid,
            keySecretRef: {
              name: secret.metadata.name,
              key: 'key',
            },
          },
          solvers: [
            {
              selector: {},
              dns01: {
                route53: {
                  region,
                },
              },
            },
          ],
        },
      },
    },
    { provider, dependsOn: [certManager] },
  );
}
