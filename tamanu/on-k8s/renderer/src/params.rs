//! The input contract between the Pulumi stub and the renderer.
//!
//! The stub resolves everything that needs the live cluster or the clock and
//! passes it here. Stack config keys keep the names they have in the
//! `tamanu-on-k8s` Pulumi project, as typed JSON.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde::de::IgnoredAny;

/// A stack config value as Pulumi stores it: always a string, with the string
/// `null` meaning unset. The values are also accepted already typed.
fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
	D: serde::Deserializer<'de>,
	T: serde::de::DeserializeOwned,
{
	use serde::de::Error;
	match Option::<serde_json::Value>::deserialize(d)? {
		None | Some(serde_json::Value::Null) => Ok(None),
		Some(serde_json::Value::String(s)) if s == "null" => Ok(None),
		Some(serde_json::Value::String(s)) => serde_json::from_str(&s)
			.map(Some)
			.map_err(|e| D::Error::custom(format!("{s:?}: {e}"))),
		Some(other) => serde_json::from_value(other)
			.map(Some)
			.map_err(D::Error::custom),
	}
}

/// [`lenient`] for text, which is taken as it is rather than parsed.
fn lenient_string<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
	D: serde::Deserializer<'de>,
{
	match Option::<String>::deserialize(d)? {
		Some(s) if s == "null" => Ok(None),
		other => Ok(other),
	}
}

fn lenient_map<'de, D>(d: D) -> Result<BTreeMap<String, String>, D::Error>
where
	D: serde::Deserializer<'de>,
{
	Ok(lenient(d)?.unwrap_or_default())
}

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
	#[serde(default, deserialize_with = "lenient_string")]
	pub namespace: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub domain_base: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub config_template: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub node_env: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub architecture: Option<String>,
	/// `spot` (the default) or `ondemand`: keeps the app servers and databases
	/// off spot capacity, for demos that must stay up.
	#[serde(default, deserialize_with = "lenient_string")]
	pub capacity: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub timezone: Option<String>,
	#[serde(default, deserialize_with = "lenient")]
	pub facilities: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub facility_names: Option<Vec<FacilityEntry>>,
	#[serde(default, deserialize_with = "lenient_map")]
	pub redirects: BTreeMap<String, String>,

	#[serde(default, deserialize_with = "lenient")]
	pub api_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub db_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub tasks_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub web_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub central_api_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub central_db_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub central_tasks_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub central_web_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub facility_api_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub facility_db_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub facility_tasks_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub facility_web_replicas: Option<u32>,
	#[serde(default, deserialize_with = "lenient")]
	pub patient_portal_replicas: Option<u32>,

	/// IAM role ARN the app service account assumes.
	#[serde(default, deserialize_with = "lenient_string")]
	pub service_account: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub db_storage: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub db_memory: Option<String>,
	#[serde(default, deserialize_with = "lenient")]
	pub db_expose: Option<bool>,
	#[serde(default, deserialize_with = "lenient")]
	pub db_az_colocate: Option<bool>,
	#[serde(default, deserialize_with = "lenient")]
	pub db_disruption_budgets: Option<bool>,
	/// Puts the blob store on a shared volume rather than each pod's own disk.
	#[serde(default, deserialize_with = "lenient")]
	pub shared_blob_storage: Option<bool>,
	#[serde(default, deserialize_with = "lenient")]
	pub backups_enabled: Option<bool>,
	#[serde(default, deserialize_with = "lenient")]
	pub backup_retention_days: Option<u32>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub barman_role_arn: Option<String>,
	#[serde(default, deserialize_with = "lenient_string")]
	pub barman_bucket: Option<String>,
	/// Marks the servers to serve the synthetic tests' random-record API, and
	/// runs the synthetic tests Deployment.
	#[serde(default, deserialize_with = "lenient")]
	pub synthetic_tests: Option<bool>,

	// Keys the program reads that nothing here renders: the Pulumi stub acts on
	// them, or they only matter to the program this one replaces.
	#[serde(default)]
	pub ttl_hours: Option<IgnoredAny>,
	#[serde(default)]
	pub ip_allow_list: Option<IgnoredAny>,
	#[serde(default)]
	pub seed_snapshot: Option<IgnoredAny>,
}
