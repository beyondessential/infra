import { codeServers, cpuRequest, imageRepository, imageTag, memoryRequest } from './config.ts';
import { envSecretName } from './secrets.ts';
import { SPOT_PREFERRED_AFFINITY, SPOT_TOLERATIONS } from './scheduling.ts';

// spec: DAGS#code-locations
export const userDeploymentsValues = codeServers.map((server) => ({
  name: server.name,
  image: { repository: imageRepository, tag: imageTag, pullPolicy: 'Always' },
  // The chart runs `dagster code-server start` with these. Its `dagsterApiGrpcArgs`
  // is the alternative, which runs `dagster api grpc` and does not reload.
  codeServerArgs: server.args,
  port: 3030,
  envSecrets: [{ name: envSecretName }],
  resources: {
    requests: { cpu: cpuRequest, memory: server.memoryRequest ?? memoryRequest },
  },
  affinity: SPOT_PREFERRED_AFFINITY,
  tolerations: SPOT_TOLERATIONS,
}));
