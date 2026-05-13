import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
import { CentralServer } from './central/CentralServer.ts';
import { FacilityServer } from './facility/FacilityServer.ts';
import { WebFrontend } from './web/WebFrontend.ts';
import { domains, facilityNames, patientPortalReplicas, replicas, syntheticTests } from './config.ts';
import { ingress } from './common/ingress.ts';
import { namespace } from './namespace.ts';
import { setupTtlHibernation } from './schedule.ts';
await failIfIncorrectCluster();

import './secrets.ts';

setupTtlHibernation(namespace);

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

ingress({
  name: 'patient-portal',
  host: domains.patientPortal,
  api: central.api,
  web: patientPortal.service,
  parent: patientPortal,
});

if (syntheticTests) {
  await import('./syntheticTests.ts');
}

export const urls = Object.fromEntries(
  Object.entries(domains).map(([key, value]) => [
    `${key[0].toUpperCase()}${key.slice(1).replace(/(\d)/, ' $1')}`,
    `https://${value}`,
  ]),
);
