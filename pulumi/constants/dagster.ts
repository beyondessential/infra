// Names the dagster and dagster-infra projects must agree on: the IRSA trust
// policy names the service account and the namespaces, and the S3 policy names
// the prefix that the chart's compute log manager writes under.
export const DAGSTER_SERVICE_ACCOUNT = 'dagster';
export const DAGSTER_NAMESPACE_PATTERN = 'dagster-*';
export const DAGSTER_COMPUTE_LOGS_PREFIX = 'dagster-compute-logs';
