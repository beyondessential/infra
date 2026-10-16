import * as k8s from '@pulumi/kubernetes';
import { type Input } from '@pulumi/pulumi';
import { cfg } from '../../../common/cfg.ts';
import { namespace } from './namespace.ts';

const secrets: { [key: string]: Input<{ [key: string]: Input<string> }> } = {
  bugsnag: {
    apiKey: cfg.requireSecret('bugsnagApiKey'),
  },
  mailgun: cfg.requireSecretObject<{ [key: string]: string }>('mailgun'),
  tupaia: cfg.requireSecretObject<{ [key: string]: string }>('tupaia'),
};

for (const [name, data] of Object.entries(secrets)) {
  new k8s.core.v1.Secret(name, {
    metadata: {
      name,
      namespace,
    },
    type: 'Opaque',
    stringData: data,
  });
}
