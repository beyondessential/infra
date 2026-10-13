//! The input contract between the Pulumi stub and the renderer.
//!
//! The stub resolves everything that needs the live cluster or the clock and
//! passes it here. Stack config keys keep the names they have in the
//! `tamanu-on-k8s` Pulumi project, as typed JSON.

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
	/// The Pulumi stack name, which names the deployment.
	pub stack: String,
	pub image_tag: String,
	#[serde(default)]
	pub app_version: Option<String>,
	#[serde(default)]
	pub config: StackConfig,
	pub cluster: Cluster,
	#[serde(default)]
	pub billing: Billing,
}

/// Facts about the cluster the stub reads from `k8s-core`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cluster {
	pub full_name: String,
	#[serde(default)]
	pub dns_zone_domains: Vec<String>,
	#[serde(default)]
	pub tailscale_proxy_default_tags: Vec<String>,
	/// The VPC's address ranges, which servers trust as proxies.
	pub network_v4_cidr: Option<String>,
	pub network_v6_cidr: Option<String>,
	/// The cluster's own Barman backup bucket, from `k8s-core`.
	pub backups_bucket: Option<String>,
	/// The IRSA role ARN CNPG pods assume to write backups, from `k8s-core`.
	/// Used for any cluster whose stack does not set `barmanRoleArn`.
	pub backups_service_account_arn: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Billing {
	pub stage: Option<String>,
	pub deployment: Option<String>,
}

/// A `facilityNames` entry: a bare name, or an id with an explicit host label.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum FacilityEntry {
	Name(String),
	Full { id: String, host: Option<String> },
}

/// Stack config as the program reads it. Defaults live in [`crate::config`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StackConfig {
	pub namespace: Option<String>,
	pub domain_base: Option<String>,
	pub config_template: Option<String>,
	pub node_env: Option<String>,
	pub architecture: Option<String>,
	/// `spot` (the default) or `ondemand`: keeps the app servers and databases
	/// off spot capacity, for demos that must stay up.
	pub capacity: Option<String>,
	pub timezone: Option<String>,
	pub facilities: Option<u32>,
	pub facility_names: Option<Vec<FacilityEntry>>,
	#[serde(default)]
	pub redirects: BTreeMap<String, String>,

	pub api_replicas: Option<u32>,
	pub db_replicas: Option<u32>,
	pub tasks_replicas: Option<u32>,
	pub web_replicas: Option<u32>,
	pub central_api_replicas: Option<u32>,
	pub central_db_replicas: Option<u32>,
	pub central_tasks_replicas: Option<u32>,
	pub central_web_replicas: Option<u32>,
	pub facility_api_replicas: Option<u32>,
	pub facility_db_replicas: Option<u32>,
	pub facility_tasks_replicas: Option<u32>,
	pub facility_web_replicas: Option<u32>,
	pub patient_portal_replicas: Option<u32>,

	/// IAM role ARN the app service account assumes.
	pub service_account: Option<String>,
	pub db_storage: Option<String>,
	pub db_memory: Option<String>,
	pub db_expose: Option<bool>,
	pub db_az_colocate: Option<bool>,
	pub db_disruption_budgets: Option<bool>,
	/// Puts the blob store on a shared volume rather than each pod's own disk.
	pub shared_blob_storage: Option<bool>,
	pub backups_enabled: Option<bool>,
	pub backup_retention_days: Option<u32>,
	pub barman_role_arn: Option<String>,
	pub barman_bucket: Option<String>,
	/// Marks the servers to serve the synthetic tests' random-record API. The
	/// synthetic tests Deployment itself is not rendered.
	pub synthetic_tests: Option<bool>,
}
