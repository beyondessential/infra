// https://gateway.envoyproxy.io/docs/install/install-helm/
// helm chart version (OCI: oci://docker.io/envoyproxy/gateway-helm)
// NOTE: for OCI charts the version tag includes the 'v' prefix
export const ENVOY_GATEWAY_VERSION = 'v1.7.1';

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

// PGRO version is in the pulumi config

// https://tailscale.com/docs/features/kubernetes-operator
// tailscale version
export const TAILSCALE_VERSION = '1.94.2';

// https://github.com/caas-team/helm-charts/tree/main/charts/py-kube-downscaler
// helm chart version
export const KUBE_DOWNSCALER_VERSION = '0.4.0';
