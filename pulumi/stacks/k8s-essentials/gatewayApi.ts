import * as k8s from '@pulumi/kubernetes';
import { GATEWAYAPI_VERSION } from './versions.ts';

export const gatewayApi = new k8s.kustomize.Directory('gateway-api', {
  directory: `https://github.com/kubernetes-sigs/gateway-api/tree/v${GATEWAYAPI_VERSION}/config/crd`,
});
