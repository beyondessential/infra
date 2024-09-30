import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';

const secrets: { [key: string]: { [key: string]: string } } = {
  bugsnag: {
    apiKey: 'REDACTED',
  },
  mailgun: {
    apiKey: 'REDACTED',
    domain: 'tupaia.org',
    from: 'tamanu@tupaia.org',
  },
  tupaia: {
    password: 'REDACTED',
    username: 'tamanu-server@tupaia.org',
  },
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
