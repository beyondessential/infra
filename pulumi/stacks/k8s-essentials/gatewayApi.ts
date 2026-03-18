import * as k8s from '@pulumi/kubernetes';
import { GATEWAYAPI_VERSION } from './versions.ts';

export const gatewayApi = new k8s.kustomize.Directory('gateway-api', {
  directory: `https://github.com/kubernetes-sigs/gateway-api/tree/v${GATEWAYAPI_VERSION}/config/crd`,
  transformations: [
    // see https://github.com/kubernetes-sigs/gateway-api/issues/4402
    (obj: any) => {
      if (obj.apiVersion === 'apiextensions.k8s.io/v1' && obj.kind === 'CustomResourceDefinition') {
        const status = obj.status;
        if (status) {
          if (status.conditions === null) delete status.conditions;
          if (status.storedVersions === null) delete status.storedVersions;
        }
      }
    },
  ],
});
