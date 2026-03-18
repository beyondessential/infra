import * as k8s from '@pulumi/kubernetes';
import { GATEWAYAPI_VERSION, GATEWAYAPI_CHANNEL } from './versions.ts';

export const gatewayApi = new k8s.kustomize.Directory('gateway-api', {
  directory: `https://github.com/kubernetes-sigs/gateway-api/tree/v${GATEWAYAPI_VERSION}/config/crd/${GATEWAYAPI_CHANNEL}`,
});
