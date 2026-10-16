//! Configuration derived from [`Params`], ported from `config.ts` in the
//! `tamanu-on-k8s` Pulumi project. Defaults, clamps and validation live here.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Result, bail};
use semver::Version;

use crate::params::{FacilityEntry, Params, StackConfig};

const NAMESPACE_PREFIX: &str = "tamanu-";
const DEMO_ZONE: &str = "demos.tamanu.app";
const DEMO_BASE_DOMAIN: &str = "demos.tamanu.app";
const MAIN_BASE_DOMAIN: &str = "cd.tamanu.app";
pub const DEFAULT_CONFIG_TEMPLATE: &str = "basic";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Architecture {
	Amd64,
	Arm64,
}

impl Architecture {
	pub fn as_str(self) -> &'static str {
		match self {
			Self::Amd64 => "amd64",
			Self::Arm64 => "arm64",
		}
	}
}

/// What kind of nodes the app servers and databases run on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capacity {
	/// Cheap, but reclaims restart pods mid-session.
	Spot,
	/// Only on-demand workload nodes.
	OnDemand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplicaConfig {
	pub api: u32,
	pub db: u32,
	pub tasks: u32,
	pub web: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Replicas {
	pub central: ReplicaConfig,
	pub facility: ReplicaConfig,
}

/// A facility's Tamanu identity and where it is served.
///
/// `id` is the facility id in the central database and the facility server's
/// device id. `host` is the subdomain label it answers on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facility {
	pub id: String,
	pub host: String,
}

#[derive(Debug, Clone)]
pub struct Domains {
	pub central: String,
	/// Facility fully qualified names, keyed by host label.
	pub facilities: BTreeMap<String, String>,
	pub patient_portal: String,
}

#[derive(Debug, Clone)]
pub struct DbConfig {
	pub storage: String,
	pub memory: String,
	pub expose: bool,
	/// Tags for the Tailscale proxy device fronting the central database.
	pub expose_tags: String,
	pub az_colocate: bool,
	pub disruption_budgets: bool,
	pub backups_enabled: bool,
	pub backup_retention_days: u32,
	/// The stack's `barmanRoleArn`, else the cluster's own backups role.
	pub barman_role_arn: Option<String>,
	/// The stack's `barmanBucket`, else the cluster's own backups bucket.
	pub barman_bucket: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Config {
	pub stack: String,
	pub namespace: String,
	pub image_tag: String,
	pub app_version: Option<String>,
	pub is_demo_cluster: bool,
	pub domain_base: String,
	pub node_env: String,
	pub architecture: Architecture,
	pub capacity: Capacity,
	pub synthetic_tests: bool,
	/// Whether a TTL schedule hibernates the deployment.
	pub has_ttl: bool,
	/// Whether to top the database up with generated data after a deploy.
	pub seed_snapshot: bool,
	/// The VolumeSnapshot the central database is restored from, if one was found.
	pub seed_snapshot_name: Option<String>,
	pub timezone: String,
	pub config_template: String,
	pub facilities: Vec<Facility>,
	pub replicas: Replicas,
	pub patient_portal_replicas: u32,
	pub domains: Domains,
	pub redirects: BTreeMap<String, String>,
	pub billing_stage: String,
	pub billing_deployment: String,
	pub service_account: Option<String>,
	/// Ranges servers trust as proxies, in the `PROXY_TRUSTED` format.
	pub proxy_trusted: String,
	/// The VPC ranges, available to config templates. Empty when unpublished.
	pub network_v4_cidr: String,
	pub network_v6_cidr: String,
	/// The rendered provisioning document, once templates have been read. The
	/// facilities' setup-sync Jobs need its admin credentials.
	pub provisioning: Option<serde_json::Value>,
	pub db: DbConfig,
	pub shared_blob_storage: bool,
	release_version: Option<Version>,
}

impl Config {
	pub fn derive(p: &Params) -> Result<Self> {
		let c = &p.config;
		let stack = normalise_stack(&p.stack);

		// spec: K8SNSP#deployment-namespaces
		let namespace = c
			.namespace
			.clone()
			.unwrap_or_else(|| format!("{NAMESPACE_PREFIX}{stack}"));
		if namespace == "system" || namespace == "super" {
			bail!("Namespace name {namespace} is reserved");
		}

		let is_demo_cluster = p.cluster.dns_zone_domains.iter().any(|d| d == DEMO_ZONE)
			|| p.cluster.full_name.contains("demo");
		let base = if is_demo_cluster {
			DEMO_BASE_DOMAIN
		} else {
			MAIN_BASE_DOMAIN
		};
		let domain_stack = if is_demo_cluster {
			stack.strip_suffix("-demo").unwrap_or(&stack).to_owned()
		} else {
			stack.clone()
		};
		let domain_base = c
			.domain_base
			.clone()
			.unwrap_or_else(|| truncate_domain_if_needed(&domain_stack, base, false));

		let architecture = match c.architecture.as_deref().unwrap_or("arm64") {
			"amd64" => Architecture::Amd64,
			"arm64" => Architecture::Arm64,
			other => bail!("Invalid architecture: {other}"),
		};
		let capacity = match c.capacity.as_deref().unwrap_or("spot") {
			"spot" => Capacity::Spot,
			"ondemand" => Capacity::OnDemand,
			other => bail!("Invalid capacity: {other}"),
		};

		let facilities = facility_list(c)?;
		let domains = Domains {
			central: format!("central.{domain_base}"),
			facilities: facilities
				.iter()
				.map(|f| (f.host.clone(), format!("{}.{domain_base}", f.host)))
				.collect(),
			patient_portal: format!("portal.{domain_base}"),
		};

		let release_version = p.app_version.as_deref().and_then(parse_semver);

		let mut expose_tags = p.cluster.tailscale_proxy_default_tags.clone();
		expose_tags.extend(["tag:server".to_owned(), "tag:server-tamanu".to_owned()]);
		if is_demo_cluster {
			expose_tags.push("tag:server-tamanu-demo".to_owned());
		}
		let db = DbConfig {
			storage: c.db_storage.clone().unwrap_or_else(|| "5Gi".into()),
			memory: c
				.db_memory
				.clone()
				.unwrap_or_else(|| if is_demo_cluster { "512Mi" } else { "750Mi" }.into()),
			expose: c.db_expose.unwrap_or(true),
			expose_tags: expose_tags.join(","),
			az_colocate: c.db_az_colocate.unwrap_or(true),
			disruption_budgets: c.db_disruption_budgets.unwrap_or(false),
			backups_enabled: c.backups_enabled.unwrap_or(false),
			backup_retention_days: c.backup_retention_days.unwrap_or(3),
			barman_role_arn: c
				.barman_role_arn
				.clone()
				.or_else(|| p.cluster.backups_service_account_arn.clone()),
			barman_bucket: c
				.barman_bucket
				.clone()
				.or_else(|| p.cluster.backups_bucket.clone()),
		};
		let node_env = c.node_env.clone().unwrap_or_else(|| "production".into());
		let proxy_trusted = ["loopback"]
			.into_iter()
			.chain(p.cluster.network_v4_cidr.as_deref())
			.chain(p.cluster.network_v6_cidr.as_deref())
			.filter(|s| !s.is_empty())
			.collect::<Vec<_>>()
			.join(", ");

		// The top-up hands the app the override that lets it write fake data, so the config
		// flag is the only thing standing between a real deployment and generated patients.
		let seed_snapshot = c.seed_snapshot.unwrap_or(false);
		if seed_snapshot && node_env == "production" {
			bail!(
				"seedSnapshot writes fake clinical data, so it needs a stack whose nodeEnv is not production"
			);
		}

		Ok(Self {
			stack,
			namespace,
			image_tag: p.image_tag.clone(),
			app_version: p.app_version.clone(),
			is_demo_cluster,
			domain_base,
			node_env,
			architecture,
			capacity,
			synthetic_tests: c.synthetic_tests.unwrap_or(false),
			has_ttl: c.ttl_hours.unwrap_or(0) > 0,
			seed_snapshot,
			seed_snapshot_name: p.seed.as_ref().map(|s| s.snapshot.clone()),
			timezone: c
				.timezone
				.clone()
				.unwrap_or_else(|| "Pacific/Auckland".into()),
			config_template: c
				.config_template
				.clone()
				.unwrap_or_else(|| DEFAULT_CONFIG_TEMPLATE.into()),
			facilities,
			replicas: Replicas {
				central: server_replicas(c, Server::Central),
				facility: server_replicas(c, Server::Facility),
			},
			patient_portal_replicas: c.patient_portal_replicas.unwrap_or(2),
			domains,
			redirects: c.redirects.clone(),
			billing_stage: p.billing.stage.clone().unwrap_or_else(|| "test".into()),
			billing_deployment: p
				.billing
				.deployment
				.clone()
				.unwrap_or_else(|| "engineering".into()),
			service_account: c.service_account.clone(),
			proxy_trusted,
			network_v4_cidr: p.cluster.network_v4_cidr.clone().unwrap_or_default(),
			network_v6_cidr: p.cluster.network_v6_cidr.clone().unwrap_or_default(),
			provisioning: None,
			db,
			shared_blob_storage: c.shared_blob_storage.unwrap_or(false),
			release_version,
		})
	}

	/// Whether the deployed Tamanu is at least `version`. An unresolvable version
	/// reads as too old: gating the other way would put a subcommand the image
	/// does not have into a Job. The version comes only from the `appVersion`
	/// parameter, which the stub reads from the image; the image tag says nothing
	/// reliable about it.
	pub fn at_least_version(&self, version: &str) -> bool {
		match (&self.release_version, parse_semver(version)) {
			(Some(release), Some(wanted)) => *release >= wanted,
			_ => false,
		}
	}
}

/// The first Tamanu release that creates and manages its own `tamanu_raw` and
/// `tamanu_reporting` roles, and no longer reads the `raw` and `reporting` roles
/// or the `DB_RAW_*` and `DB_REPORTING_*` variables that carried their logins.
const TAMANU_MANAGES_REPORT_ROLES: &str = "2.60.0-0";

impl Config {
	/// Whether the deployment still needs the `raw` and `reporting` database
	/// roles, their password Secrets and the variables that read them. An
	/// unresolvable version reads as too old, so they are kept.
	pub fn has_legacy_report_roles(&self) -> bool {
		!self.at_least_version(TAMANU_MANAGES_REPORT_ROLES)
	}
}

/// Mirrors `semver.valid`, which tolerates a leading `v` or `=`.
fn parse_semver(s: &str) -> Option<Version> {
	Version::parse(s.trim().trim_start_matches(['v', '=']).trim()).ok()
}

/// A stack name as a namespace-safe label: lowercase, runs of other characters
/// collapsed to a hyphen, and short enough to take the `tamanu-` prefix.
pub fn normalise_stack(stack: &str) -> String {
	let mut out = String::with_capacity(stack.len());
	let mut in_run = false;
	for ch in stack.to_lowercase().chars() {
		if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' {
			out.push(ch);
			in_run = false;
		} else if !in_run {
			out.push('-');
			in_run = true;
		}
	}
	let trimmed = out.trim_end_matches('-');
	let max = 63 - NAMESPACE_PREFIX.len();
	let cut: String = trimmed.chars().take(max).collect();
	cut.trim_matches('-').to_owned()
}

pub fn truncate_domain_if_needed(domain: &str, zone: &str, whole_domain: bool) -> String {
	let max = if whole_domain {
		64usize.saturating_sub(zone.len())
	} else {
		64
	};
	let mut domain: String = domain.to_owned();
	if domain.len() >= max {
		domain = domain.chars().take(max.saturating_sub(1)).collect();
	}
	if domain.ends_with('-') {
		domain.pop();
	}
	format!("{domain}.{zone}")
}

fn facility_list(c: &StackConfig) -> Result<Vec<Facility>> {
	let wanted = c.facilities.unwrap_or(2) as usize;
	let entries: Vec<FacilityEntry> = c.facility_names.clone().unwrap_or_default();
	if entries.len() > wanted {
		bail!("Cannot have more facilityNames than facilities");
	}

	let mut list = Vec::with_capacity(wanted);
	for entry in entries {
		list.push(match entry {
			// A bare name is lowercased for both: deployments predating the split
			// have lowercase facility ids in their databases.
			FacilityEntry::Name(name) => {
				let name = name.to_lowercase();
				Facility {
					id: name.clone(),
					host: name,
				}
			}
			FacilityEntry::Full { id, host } => {
				if id.is_empty() {
					bail!("Facility entries must have an id");
				}
				// Case survives in the id, but a hostname label cannot carry it.
				let host = host.unwrap_or_else(|| id.clone()).to_lowercase();
				Facility { id, host }
			}
		});
	}
	let named = list.len();
	for i in 0..(wanted - named) {
		let name = format!("facility-{}", named + i + 1);
		list.push(Facility {
			id: name.clone(),
			host: name,
		});
	}

	let ids: BTreeSet<_> = list.iter().map(|f| &f.id).collect();
	if ids.len() != list.len() {
		bail!("Facility ids must be unique");
	}
	let hosts: BTreeSet<_> = list.iter().map(|f| &f.host).collect();
	if hosts.len() != list.len() {
		bail!("Facility hosts must be unique");
	}
	Ok(list)
}

#[derive(Clone, Copy)]
enum Server {
	Central,
	Facility,
}

// spec: TDR#replicas
const MIN: ReplicaConfig = ReplicaConfig {
	api: 0,
	db: 2,
	tasks: 0,
	web: 0,
};
const MAX: ReplicaConfig = ReplicaConfig {
	api: 5,
	db: 3,
	tasks: 1,
	web: 5,
};
const DEFAULT: ReplicaConfig = ReplicaConfig {
	api: 2,
	db: 2,
	tasks: 1,
	web: 2,
};

fn server_replicas(c: &StackConfig, server: Server) -> ReplicaConfig {
	let (api, db, tasks, web) = match server {
		Server::Central => (
			c.central_api_replicas,
			c.central_db_replicas,
			c.central_tasks_replicas,
			c.central_web_replicas,
		),
		Server::Facility => (
			c.facility_api_replicas,
			c.facility_db_replicas,
			c.facility_tasks_replicas,
			c.facility_web_replicas,
		),
	};
	let clamp = |specific: Option<u32>, generic: Option<u32>, min: u32, max: u32, default: u32| {
		specific.or(generic).unwrap_or(default).min(max).max(min)
	};
	ReplicaConfig {
		api: clamp(api, c.api_replicas, MIN.api, MAX.api, DEFAULT.api),
		db: clamp(db, c.db_replicas, MIN.db, MAX.db, DEFAULT.db),
		tasks: clamp(tasks, c.tasks_replicas, MIN.tasks, MAX.tasks, DEFAULT.tasks),
		web: clamp(web, c.web_replicas, MIN.web, MAX.web, DEFAULT.web),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalises_stack_names() {
		assert_eq!(normalise_stack("Release/2.66"), "release-2-66");
		assert_eq!(normalise_stack("feat--x-"), "feat--x");
		assert_eq!(normalise_stack(&"a".repeat(80)).len(), 56);
	}

	#[test]
	fn truncates_domains_without_trailing_hyphen() {
		assert_eq!(
			truncate_domain_if_needed("main", "cd.tamanu.app", false),
			"main.cd.tamanu.app"
		);
		let long = format!("{}-b", "a".repeat(62));
		let out = truncate_domain_if_needed(&long, "z", false);
		assert!(!out.starts_with(&long));
		assert!(!out.contains("-."));
	}

	#[test]
	fn version_gates_read_unknown_as_old() {
		let mut p = params("sha-abcdef");
		let cfg = Config::derive(&p).unwrap();
		assert!(!cfg.at_least_version("2.65.0-0"));

		p.app_version = Some("2.66.1".into());
		let cfg = Config::derive(&p).unwrap();
		assert!(cfg.at_least_version("2.65.0-0"));

		p.app_version = None;
		p.image_tag = "v2.70.0".into();
		let cfg = Config::derive(&p).unwrap();
		assert!(!cfg.at_least_version("2.65.0-0"));
	}

	#[test]
	fn legacy_report_roles_end_at_2_60() {
		let mut p = params("sha-abcdef");
		for (version, legacy) in [
			(None, true),
			(Some("2.59.9"), true),
			(Some("2.60.0-beta.1"), false),
			(Some("2.60.0"), false),
			(Some("2.67.0"), false),
		] {
			p.app_version = version.map(Into::into);
			let cfg = Config::derive(&p).unwrap();
			assert_eq!(cfg.has_legacy_report_roles(), legacy, "{version:?}");
		}
	}

	#[test]
	fn fills_facilities_and_lowercases_hosts() {
		let mut p = params("sha-x");
		p.config.facilities = Some(3);
		p.config.facility_names = Some(vec![
			FacilityEntry::Name("Kule".into()),
			FacilityEntry::Full {
				id: "Bravo".into(),
				host: None,
			},
		]);
		let cfg = Config::derive(&p).unwrap();
		let got: Vec<_> = cfg
			.facilities
			.iter()
			.map(|f| (f.id.as_str(), f.host.as_str()))
			.collect();
		assert_eq!(
			got,
			[
				("kule", "kule"),
				("Bravo", "bravo"),
				("facility-3", "facility-3")
			]
		);
	}

	#[test]
	fn clamps_replicas() {
		let mut p = params("sha-x");
		p.config.api_replicas = Some(50);
		p.config.central_db_replicas = Some(0);
		let cfg = Config::derive(&p).unwrap();
		assert_eq!(cfg.replicas.facility.api, 5);
		assert_eq!(cfg.replicas.central.db, 2);
	}

	#[test]
	fn derives_proxy_and_db_settings() {
		let mut p = params("sha-x");
		p.cluster.network_v4_cidr = Some("10.0.0.0/16".into());
		p.cluster.tailscale_proxy_default_tags = vec!["tag:k8s".into()];
		let cfg = Config::derive(&p).unwrap();
		assert_eq!(cfg.proxy_trusted, "loopback, 10.0.0.0/16");
		assert_eq!(cfg.db.expose_tags, "tag:k8s,tag:server,tag:server-tamanu");
		assert_eq!(cfg.db.memory, "750Mi");
		assert!(cfg.db.expose && cfg.db.az_colocate && !cfg.db.disruption_budgets);

		p.cluster.full_name = "example-demo".into();
		p.config.db_memory = Some("1Gi".into());
		let cfg = Config::derive(&p).unwrap();
		assert!(cfg.db.expose_tags.ends_with("tag:server-tamanu-demo"));
		assert_eq!(cfg.db.memory, "1Gi");
	}

	pub(crate) fn params(image_tag: &str) -> Params {
		serde_json::from_value(serde_json::json!({
			"stack": "main",
			"imageTag": image_tag,
			"cluster": { "fullName": "tamanu-internal-main" },
		}))
		.unwrap()
	}
}
