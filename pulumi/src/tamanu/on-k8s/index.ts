import { getStack } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg, failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
import { namespace } from './namespace.js';
await failIfIncorrectCluster();

const domainBase = cfg.get('domainBase') ?? `${getStack()}.internal.tamanu.io`;
const dbStorage = cfg.get('dbStorage') ?? '5Gi';

export const domains = {
  central: `central.${domainBase}`,
  facility1: `facility-1.${domainBase}`,
  facility2: `facility-2.${domainBase}`,
};

const central = new CentralServer('central', {
  fqdn: domains.central,
  dbStorage,
});

new FacilityServer(
  '1',
  {
    fqdn: domains.facility1,
    centralApiUrl: `http://${domains.central}`,
    facilityId: 'facility-1',
    deviceId: 'facility-1',
    dbStorage,
  },
  { dependsOn: [central] },
);

new FacilityServer(
  '2',
  {
    fqdn: domains.facility2,
    centralApiUrl: `http://${domains.central}`,
    facilityId: 'facility-2',
    deviceId: 'facility-2',
    dbStorage,
  },
  { dependsOn: [central] },
);

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
