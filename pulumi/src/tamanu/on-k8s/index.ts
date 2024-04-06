import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
import { namespace } from './namespace.js';
import { domainBase, domains, facilities, replicas } from './config.js';
await failIfIncorrectCluster();

const central = new CentralServer('central', {
  fqdn: domains.central,
  replicas: replicas.central,
});

for (let i = 1; i <= facilities; i += 1) {
  new FacilityServer(`${i}`, {
    fqdn: domains[`facility${i}`],
    centralApiUrl: `http://${domains.central}`,
    facilityId: `facility-${i}`,
    deviceId: `facility-${i}`,
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
