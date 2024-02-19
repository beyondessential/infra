import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { CentralServer } from './central/CentralServer.js';
import { FacilityServer } from './facility/FacilityServer.js';
await failIfIncorrectCluster();

const central = new CentralServer('central-server', {
  apiReplicas: 2,
  dbReplicas: 2,
  dbStorage: '5Gi',
});

new FacilityServer('1', {
  centralApiService: central.apiService,
  facilityId: 'facility-1',
  deviceId: 'facility-1',
  dbStorage: '5Gi',
});

new FacilityServer('2', {
  centralApiService: central.apiService,
  facilityId: 'facility-2',
  deviceId: 'facility-2',
  dbStorage: '5Gi',
});
