import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
import { WebFrontend } from './web/WebFrontend.js';
import { namespace } from './namespace.js';
import { domainBase, domains, facilityNames, patientPortalReplicas, replicas } from './config.js';
await failIfIncorrectCluster();

import './secrets.js';
import { ingress } from './common/ingress.js';

const central = new CentralServer('central', {
  fqdn: domains.central,
  replicas: replicas.central,
});

for (const [i, name] of facilityNames.entries()) {
  new FacilityServer(`${i + 1}`, {
    fqdn: domains[name],
    centralApiUrl: `https://${domains.central}`,
    facilityId: name,
    deviceId: name,
    replicas: replicas.facility,
    provisioning: central.provisioning,
  });
}

const patientPortal = new WebFrontend('patient-portal', {
  serverType: 'patient-portal',
  imageType: 'patient-portal',
  replicas: patientPortalReplicas,
});

const patientPortalIngress = ingress({
  name: 'patient-portal',
  host: domains.patientPortal,
  api: central.api,
  web: patientPortal.service,
  parent: patientPortal,
});

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
