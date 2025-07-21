import * as k8s from '@pulumi/kubernetes';

export const gatewayApi = new k8s.kustomize.Directory('gateway-api', {
  directory: 'https://github.com/kubernetes-sigs/gateway-api/tree/v0.8.1/config/crd/experimental',
});
