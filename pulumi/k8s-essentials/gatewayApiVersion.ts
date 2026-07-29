import { ApiextensionsV1Api } from '@kubernetes/client-node';
import * as semver from 'semver';
import { k8sClient } from '../common/k8s/client.ts';

const BUNDLE_ANNOTATION = 'gateway.networking.k8s.io/bundle-version';

// Any Gateway API CRD carries the bundle version; gateways is the one guaranteed
// to be present on a cluster running Envoy Gateway at all.
const PROBE_CRD = 'gateways.gateway.networking.k8s.io';

/**
 * Refuse to deploy an Envoy Gateway the cluster's Gateway API CRDs cannot serve.
 *
 * Envoy Gateway ships the Gateway API CRDs in its chart's `crds/` directory,
 * which Helm installs on first install and never touches again. A controller
 * upgrade therefore runs against whatever CRD bundle the cluster was built with,
 * and fails by crash-looping on a kind that does not exist — surfacing as a Helm
 * release timing out, which says nothing about the cause.
 */
export async function failIfGatewayApiTooOld(required: string, forVersion: string): Promise<void> {
  const api = k8sClient(ApiextensionsV1Api);

  let installed: string | undefined;
  try {
    const crd = await api.readCustomResourceDefinition({ name: PROBE_CRD });
    installed = crd.metadata?.annotations?.[BUNDLE_ANNOTATION];
  } catch (err) {
    // A cluster with no Gateway API at all is a first install, where the chart's
    // own crds/ will provide the right bundle. Nothing to check.
    if ((err as { code?: number }).code === 404) {
      return;
    }

    throw err;
  }

  if (!installed) {
    console.warn(
      `Could not read ${BUNDLE_ANNOTATION} from ${PROBE_CRD}; skipping the Gateway API version check`,
    );
    return;
  }

  if (semver.lt(semver.coerce(installed) ?? '0.0.0', semver.coerce(required) ?? '0.0.0')) {
    throw new Error(
      [
        `Envoy Gateway ${forVersion} needs Gateway API ${required}, but this cluster has ${installed}.`,
        'Helm does not upgrade CRDs shipped in a chart, so they have to be applied directly:',
        '  kubectl apply --server-side --force-conflicts -f \\',
        `    https://github.com/kubernetes-sigs/gateway-api/releases/download/${required}/experimental-install.yaml`,
      ].join('\n'),
    );
  }
}
