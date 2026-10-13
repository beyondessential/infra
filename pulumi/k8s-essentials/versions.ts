// https://gateway.envoyproxy.io/docs/install/install-helm/
// helm chart version (OCI: oci://docker.io/envoyproxy/gateway-helm)
// NOTE: for OCI charts the version tag includes the 'v' prefix
// 1.8 is the floor: ClientTrafficPolicy's clientValidation.mode, which canopy
// needs to request an unverified client certificate, does not exist before it.
export const ENVOY_GATEWAY_VERSION = 'v1.8.3';

// Gateway API CRD bundle the above needs, from the experimental channel (a
// superset of standard, adding TCPRoute, UDPRoute, BackendTLSPolicy, ListenerSet).
//
// This coupling is load-bearing and Helm will not maintain it: CRDs shipped in a
// chart's crds/ directory are installed once and never touched by an upgrade. So
// bumping ENVOY_GATEWAY_VERSION alone leaves the CRDs behind, and the new
// controller crash-loops on whatever kind it gained — 1.8 watches ListenerSet,
// which arrived in Gateway API 1.5. envoyGateway.ts checks the installed bundle
// against this and refuses to deploy a controller the cluster cannot run.
//
// Upgrade the CRDs before raising either version:
//   kubectl apply --server-side --force-conflicts -f \
//     https://github.com/kubernetes-sigs/gateway-api/releases/download/vX.Y.Z/experimental-install.yaml
export const GATEWAY_API_VERSION = 'v1.5.1';

// The HNC project is essentially dead and this is the last version
// We do depend on it for operational security, but eventually should probably migrate
// away by physically separating the Kubernetes clusters, ie have one cluster entirely
// for Tamanu testing, one for production data (replicas), one for Tamanu SaaS, etc.
// https://github.com/kubernetes-retired/hierarchical-namespaces
// tag on the repo
export const HNC_VERSION = '1.1.0';

// https://artifacthub.io/packages/helm/ingress-nginx/ingress-nginx
// helm chart version
export const NGINXINGRESS_VERSION = '4.15.1';

// https://artifacthub.io/packages/helm/opencost/opencost
// helm chart version
export const OPENCOST_VERSION = '2.5.11';

// https://artifacthub.io/packages/helm/prometheus-community/prometheus
// helm chart version
export const PROMETHEUS_VERSION = '28.13.0';

// https://artifacthub.io/packages/helm/cloudnative-pg/cloudnative-pg
// helm chart version
export const CNPG_VERSION = '0.27.1';

// https://tailscale.com/docs/features/kubernetes-operator
// tailscale version
export const TAILSCALE_VERSION = '1.94.2';

// https://caas-team.github.io/helm-charts/index.yaml (chart: py-kube-downscaler)
// helm chart version
export const KUBE_DOWNSCALER_VERSION = '0.3.12';

// https://artifacthub.io/packages/helm/cloudnative-pg/plugin-barman-cloud
// helm chart version (plugin image version is v0.12.0)
export const BARMAN_CLOUD_PLUGIN_VERSION = '0.6.0';
