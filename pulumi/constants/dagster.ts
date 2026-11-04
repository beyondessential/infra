// Names the dagster and dagster-infra projects must agree on: the IRSA trust
// policy names the service account and the namespaces, and the S3 policy names
// the prefix that the chart's compute log manager writes under.
export const DAGSTER_SERVICE_ACCOUNT = 'dagster';
export const DAGSTER_NAMESPACE_PATTERN = 'dagster-*';
export const DAGSTER_COMPUTE_LOGS_PREFIX = 'dagster-compute-logs';
// The k8s-db-proxy stack runs in this namespace and names its Service after the
// first label of the RDS endpoint, which for an instance is its identifier.
export const DB_PROXY_NAMESPACE = 'db-proxy';
