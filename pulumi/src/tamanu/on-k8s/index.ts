import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
await failIfIncorrectCluster();

// const superdomain = cfg.get('superdomain') ?? stackName;

const central = new CentralServer('central-server', {
  apiReplicas: 3,
  dbReplicas: 2,
  dbStorage: '5Gi',
});

for (const n of Array(60).fill(0).keys()) {
  new FacilityServer(n.toString(), {
    centralApiService: central.apiService,
    facilityId: 'test',
    deviceId: `facility-${n}`,
    dbStorage: '2Gi',
  });
}
