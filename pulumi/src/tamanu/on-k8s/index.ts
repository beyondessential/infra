import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
import { namespace } from './namespace.js';
import {
  domainBase,
  domains,
  facilityNames,
  replicas,
  serviceAccount,
  SERVICE_ACCOUNT_NAME,
} from './config.js';
await failIfIncorrectCluster();

import './secrets.js';

if (serviceAccount) {
  new k8s.core.v1.ServiceAccount('app-sa', {
    metadata: {
      name: SERVICE_ACCOUNT_NAME,
      namespace,
      annotations: {
        'eks.amazonaws.com/role-arn': serviceAccount,
      },
    },
  });
}

const central = new CentralServer('central', {
  fqdn: domains.central,
  replicas: replicas.central,
});

for (const name of facilityNames) {
  new FacilityServer(name, {
    fqdn: domains[name],
    centralApiUrl: `https://${domains.central}`,
    facilityId: name,
    deviceId: name,
    replicas: replicas.facility,
    provisioning: central.provisioning,
  });
}

new k8s.networking.v1.Ingress('bare-domain', {
  metadata: {
    namespace,
    name: 'bare-domain',
  },
  spec: {
    ingressClassName: 'nginx',
    rules: [
      {
        host: domainBase,
      },
    ],
  },
});

export const urls = Object.fromEntries(
  Object.entries(domains).map(([key, value]) => [
    `${key[0].toUpperCase()}${key.slice(1).replace(/(\d)/, ' $1')}`,
    `https://${value}`,
  ]),
);
