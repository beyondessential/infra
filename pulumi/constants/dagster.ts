// Names the dagster and dagster-infra projects must agree on: the IRSA trust
// policy names the service account and the namespace, and the S3 policy names
// the prefix that the chart's compute log manager writes under.
export const DAGSTER_SERVICE_ACCOUNT = 'dagster';
export const DAGSTER_COMPUTE_LOGS_PREFIX = 'dagster-compute-logs';

// The namespace of an instance, from the name of its stack. A dagster-infra
// stack and the dagster stack it serves share a stack name, so they agree on it.
export const dagsterNamespace = (stack: string): string =>
  `dagster-${stack
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+$/, '')
    .slice(0, 63 - 'dagster-'.length) // 63 is the max length of a k8s namespace, minus the prefix
    .replace(/^-+|-+$/g, '')}`;
