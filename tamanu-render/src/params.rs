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
}
