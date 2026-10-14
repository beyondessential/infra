//! CloudNativePG cluster for one Tamanu server, ported from `runPostgres` in
//! `common/k8s/postgres.ts` and its tuning, cron and URL helpers.
//!
//! Servers connect with the `uri` CNPG puts in the cluster's `app` Secret (see
//! [`names::DB_APP_URI_KEY`]), so no connection-string Secret is built for them.
//! The readiness wait on the cluster is replaced by sync waves: the cluster is
//! in [`waves::BASE`] and everything that needs it healthy runs in a later wave.

pub mod cron;
pub mod reporting;
pub mod tuning;

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use k8s_openapi::api::core::v1::{Service, ServicePort, ServiceSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::{Map, Value, json};

use crate::config::Config;
use crate::meta::cost_labels;
use crate::names;
use crate::pod::spot_toleration;
use crate::waves;

pub use reporting::{reporting_grants, reporting_roles};

pub const DEFAULT_POSTGRES_VERSION: u32 = 18;
const DEFAULT_MEMORY_REQUEST: &str = "750Mi";
const DEFAULT_MAX_CONNECTIONS: u32 = 100;
const BARMAN_PLUGIN: &str = "barman-cloud.cloudnative-pg.io";

#[derive(Debug, Clone, Default)]
pub struct BarmanBackup {
	pub bucket: String,
	pub deploy_name: String,
	pub retention_days: u32,
}

#[derive(Debug, Clone, Default)]
pub struct ManagedRole {
	pub name: String,
	/// Name of the Secret holding the role's password.
	pub password_secret: String,
	pub login: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PgArgs {
	/// `central` or `facility-N`. The cluster is named `{name}-db`.
	pub name: String,
	pub replicas: u32,
	pub storage: String,
	pub timezone: String,
	pub roles: Vec<ManagedRole>,
	pub init_sql: String,
	/// Restores the cluster from this VolumeSnapshot, in this namespace, in place of an
	/// empty database.
	pub seed_snapshot: Option<String>,
	/// Propagated to every pod in the cluster, for AWS split cost allocation.
	pub inherited_metadata_labels: BTreeMap<String, String>,
	/// Overrides the stack's `barmanRoleArn` and the cluster's own backups role.
	/// With none of the three the annotation is omitted.
	pub barman_role_arn: Option<String>,
	/// Enables Barman Cloud WAL archiving and scheduled base backups.
	pub barman_backup: Option<BarmanBackup>,
	/// Requires all instances in the same AZ, still on different nodes via
	/// CNPG's default hostname anti-affinity. Keeps replication traffic off the
	/// cross-AZ meter at the cost of AZ-failure tolerance.
	pub colocate_az: bool,
	/// Keeps CNPG's PodDisruptionBudgets. The primary's budget allows no
	/// evictions, so every node holding a primary is exempt from consolidation.
	pub disruption_budgets: bool,
	/// Memory request of the postgres container, and the basis every
	/// memory-derived parameter is computed from. Defaults to 750Mi.
	pub memory_request: Option<String>,
}

impl PgArgs {
	/// The arguments the Tamanu servers give their cluster: storage, memory,
	/// placement, backups and cost labels all from the stack config.
	pub fn from_config(
		cfg: &Config,
		name: &str,
		replicas: u32,
		roles: Vec<ManagedRole>,
		init_sql: String,
	) -> Result<Self> {
		let barman_backup = if cfg.db.backups_enabled {
			let Some(bucket) = cfg.db.barman_bucket.clone() else {
				bail!(
					"backupsEnabled needs a bucket: set barmanBucket or provide the cluster's backups bucket"
				);
			};
			Some(BarmanBackup {
				bucket,
				deploy_name: cfg.stack.clone(),
				retention_days: cfg.db.backup_retention_days,
			})
		} else {
			None
		};
		Ok(Self {
			name: name.into(),
			replicas,
			storage: cfg.db.storage.clone(),
			timezone: cfg.timezone.clone(),
			roles,
			init_sql,
			seed_snapshot: None,
			inherited_metadata_labels: cost_labels(cfg),
			barman_role_arn: cfg.db.barman_role_arn.clone(),
			barman_backup,
			colocate_az: cfg.db.az_colocate,
			disruption_budgets: cfg.db.disruption_budgets,
			memory_request: Some(cfg.db.memory.clone()),
		})
	}
}

/// Where a cluster's instances run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Placement {
	/// Prefers spot capacity.
	#[default]
	Spot,
	/// Only the general on-demand workload pools, one instance per node.
	OnDemand,
	/// Only the on-demand `db-critical` pool, one instance per node.
	Dedicated,
}

impl From<crate::config::Capacity> for Placement {
	fn from(capacity: crate::config::Capacity) -> Self {
		match capacity {
			crate::config::Capacity::Spot => Self::Spot,
			crate::config::Capacity::OnDemand => Self::OnDemand,
		}
	}
}

/// Cluster options no Tamanu server sets, with the defaults `runPostgres` has.
#[derive(Debug, Clone)]
pub struct PgOptions {
	pub major_version: u32,
	pub postgis: bool,
	/// Raising it divides work_mem across more backends, so raise the memory
	/// request alongside. Changing it triggers a rolling restart.
	pub max_connections: u32,
	pub placement: Placement,
	/// Exposes CNPG's `:9187` metrics to the annotation-based Prometheus through
	/// a dedicated metrics-only Service. Annotating the cluster pods directly
	/// would also annotate the rw/r/ro Services and double-scrape.
	pub scrape_metrics: bool,
}

impl Default for PgOptions {
	fn default() -> Self {
		Self {
			major_version: DEFAULT_POSTGRES_VERSION,
			postgis: false,
			max_connections: DEFAULT_MAX_CONNECTIONS,
			placement: Placement::Spot,
			scrape_metrics: false,
		}
	}
}

/// A Tamanu server's cluster, placed on the capacity the stack asks for.
pub fn run_postgres(cfg: &Config, args: PgArgs) -> Result<Vec<Value>> {
	let opts = PgOptions {
		placement: cfg.capacity.into(),
		..PgOptions::default()
	};
	run_postgres_with(cfg, args, &opts)
}

pub fn run_postgres_with(cfg: &Config, args: PgArgs, opts: &PgOptions) -> Result<Vec<Value>> {
	let cluster_name = names::db_cluster(&args.name);
	let role_arn = args
		.barman_role_arn
		.clone()
		.or_else(|| cfg.db.barman_role_arn.clone());

	let mut out = vec![waves::in_wave(
		cluster(cfg, &args, opts, &cluster_name, role_arn.as_deref())?,
		waves::BASE,
	)];

	// Backups are Barman only. Scheduled volume snapshots are not an option,
	// because CNPG has no retention for them (cloudnative-pg#6009) and they
	// recover only to the snapshot instant, where Barman archives WAL
	// continuously.
	if let Some(backup) = &args.barman_backup {
		let store_name = object_store_name(&cluster_name);
		out.push(waves::in_wave(
			object_store(cfg, &store_name, &cluster_name, backup),
			waves::BASE,
		));
		out.push(waves::in_wave(
			scheduled_backup(cfg, &cluster_name),
			waves::BASE,
		));
	}

	if opts.scrape_metrics {
		out.push(waves::in_wave(
			serde_json::to_value(metrics_service(cfg, &args.name, &cluster_name))?,
			waves::BASE,
		));
	}

	Ok(out)
}

fn object_store_name(cluster_name: &str) -> String {
	format!("{cluster_name}-object-store")
}

fn labels(name: &str) -> Value {
	json!({
		"app.kubernetes.io/name": name,
		"app.kubernetes.io/component": "database",
	})
}

fn affinity(args: &PgArgs, opts: &PgOptions, cluster_name: &str) -> Result<Value> {
	let mut node_selector = json!({
		"bes.node.purpose": "workload",
		// arm64 is the default workload arch, and both the standard cnpg
		// postgres image and the postgis variant publish arm64. Pinning it
		// here lets the autoscaler grow the arm pool in the right AZ rather
		// than the scheduler landing on a leftover amd64 node.
		"bes.node.arch": "arm64",
	});
	let mut affinity = Map::new();
	match opts.placement {
		Placement::Dedicated => {
			node_selector["bes.node.group"] = json!("db-critical");
			affinity.insert(
				"tolerations".into(),
				json!([{
					"key": "bes.node.group",
					"operator": "Equal",
					"value": "db-critical",
					"effect": "NoSchedule",
				}]),
			);
			affinity.insert("podAntiAffinityType".into(), json!("required"));
		}
		Placement::OnDemand => {
			node_selector["bes.node.schedule"] = json!("ondemand");
			affinity.insert("podAntiAffinityType".into(), json!("required"));
		}
		Placement::Spot => {
			affinity.insert("tolerations".into(), json!([spot_toleration()]));
			affinity.insert(
				"nodeAffinity".into(),
				json!({
					"preferredDuringSchedulingIgnoredDuringExecution": [{
						"weight": 1,
						"preference": {
							"matchExpressions": [{
								"key": "bes.node.schedule",
								"operator": "In",
								"values": ["spot"],
							}],
						},
					}],
				}),
			);
		}
	}
	affinity.insert("nodeSelector".into(), node_selector);
	if args.colocate_az {
		affinity.insert(
			"additionalPodAffinity".into(),
			json!({
				"requiredDuringSchedulingIgnoredDuringExecution": [{
					"labelSelector": { "matchLabels": { "cnpg.io/cluster": cluster_name } },
					"topologyKey": "topology.kubernetes.io/zone",
				}],
			}),
		);
	}
	Ok(Value::Object(affinity))
}

fn managed_role(role: &ManagedRole) -> Value {
	let mut v = json!({ "name": role.name, "login": role.login });
	if !role.password_secret.is_empty() {
		v["passwordSecret"] = json!({ "name": role.password_secret });
	}
	v
}

fn cluster(
	cfg: &Config,
	args: &PgArgs,
	opts: &PgOptions,
	cluster_name: &str,
	role_arn: Option<&str>,
) -> Result<Value> {
	let memory = args
		.memory_request
		.as_deref()
		.unwrap_or(DEFAULT_MEMORY_REQUEST);

	// Derived from the memory request and the volume size, so a cluster given
	// more resources gets parameters to match.
	let parameters = tuning::derive_postgres_parameters(tuning::TuningArgs {
		memory,
		storage: &args.storage,
		max_connections: opts.max_connections,
	})?;

	let mut spec = Map::new();
	if !args.inherited_metadata_labels.is_empty() {
		spec.insert(
			"inheritedMetadata".into(),
			json!({ "labels": args.inherited_metadata_labels }),
		);
	}
	spec.insert(
		"imageCatalogRef".into(),
		json!({
			"apiGroup": "postgresql.cnpg.io",
			"kind": "ClusterImageCatalog",
			"name": if opts.postgis { "postgis-system-bookworm" } else { "postgresql" },
			"major": opts.major_version,
		}),
	);
	spec.insert("instances".into(), json!(args.replicas));
	spec.insert("enablePDB".into(), json!(args.disruption_budgets));
	// CNPG maintains the `{name}-db-superuser` Secret only when superuser access
	// is enabled, which it is not by default since CNPG 1.21. The reporting
	// grants Job and the `{name}-db-url` Secret read it.
	spec.insert("enableSuperuserAccess".into(), json!(true));
	spec.insert("primaryUpdateStrategy".into(), json!("unsupervised"));
	// The operator rejects any single update that changes both the image and
	// postgres parameters under this method, so such changes are split.
	spec.insert("primaryUpdateMethod".into(), json!("switchover"));
	spec.insert("storage".into(), json!({ "size": args.storage }));
	spec.insert(
		"env".into(),
		json!([{ "name": "TZ", "value": args.timezone }]),
	);
	spec.insert(
		"resources".into(),
		json!({ "requests": { "memory": memory, "cpu": "10m" } }),
	);
	spec.insert("postgresql".into(), json!({ "parameters": parameters }));
	spec.insert(
		"managed".into(),
		json!({ "roles": args.roles.iter().map(managed_role).collect::<Vec<_>>() }),
	);
	spec.insert(
		"bootstrap".into(),
		if let Some(snapshot) = &args.seed_snapshot {
			// The CRD validates this as a core/v1 TypedLocalObjectReference, which needs the
			// group and kind as strings.
			json!({ "recovery": { "volumeSnapshots": { "storage": {
				"apiGroup": "snapshot.storage.k8s.io",
				"kind": "VolumeSnapshot",
				"name": snapshot,
			} } } })
		} else if args.init_sql.is_empty() {
			json!({})
		} else {
			json!({ "initdb": { "postInitApplicationSQL": [args.init_sql] } })
		},
	);
	spec.insert("affinity".into(), affinity(args, opts, cluster_name)?);
	if let Some(arn) = role_arn {
		spec.insert(
			"serviceAccountTemplate".into(),
			json!({ "metadata": { "annotations": { "eks.amazonaws.com/role-arn": arn } } }),
		);
	}
	if args.barman_backup.is_some() {
		spec.insert(
			"plugins".into(),
			json!([{
				"name": BARMAN_PLUGIN,
				"isWALArchiver": true,
				"parameters": {
					"barmanObjectName": object_store_name(cluster_name),
					"serverName": cluster_name,
				},
			}]),
		);
	}

	Ok(json!({
		"apiVersion": "postgresql.cnpg.io/v1",
		"kind": "Cluster",
		"metadata": {
			"name": cluster_name,
			"namespace": cfg.namespace,
			"labels": labels(&args.name),
		},
		"spec": spec,
	}))
}

fn object_store(
	cfg: &Config,
	store_name: &str,
	cluster_name: &str,
	backup: &BarmanBackup,
) -> Value {
	json!({
		"apiVersion": "barmancloud.cnpg.io/v1",
		"kind": "ObjectStore",
		"metadata": { "name": store_name, "namespace": cfg.namespace },
		"spec": {
			"retentionPolicy": format!("{}d", backup.retention_days),
			"instanceSidecarConfiguration": {
				"resources": { "requests": { "cpu": "10m", "memory": "128Mi" } },
			},
			"configuration": {
				"destinationPath": format!(
					"s3://{}/{}/{cluster_name}/",
					backup.bucket, backup.deploy_name
				),
				"s3Credentials": { "inheritFromIAMRole": true },
				"wal": { "compression": "gzip" },
				"data": { "compression": "gzip" },
			},
		},
	})
}

fn scheduled_backup(cfg: &Config, cluster_name: &str) -> Value {
	json!({
		"apiVersion": "postgresql.cnpg.io/v1",
		"kind": "ScheduledBackup",
		"metadata": { "name": format!("{cluster_name}-scheduled"), "namespace": cfg.namespace },
		"spec": {
			"schedule": "0 0 2 * * *",
			"immediate": true,
			"backupOwnerReference": "self",
			"cluster": { "name": cluster_name },
			"method": "plugin",
			"pluginConfiguration": { "name": BARMAN_PLUGIN },
		},
	})
}

/// The annotation-based Prometheus scrapes CNPG's `:9187` exporter once per
/// instance pod through this endpoint. It is kept apart from the rw/r/ro
/// Services so only this one carries the scrape annotation.
fn metrics_service(cfg: &Config, name: &str, cluster_name: &str) -> Service {
	let to_map = |pairs: &[(&str, &str)]| -> BTreeMap<String, String> {
		pairs
			.iter()
			.map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
			.collect()
	};
	Service {
		metadata: ObjectMeta {
			name: Some(format!("{cluster_name}-metrics")),
			namespace: Some(cfg.namespace.clone()),
			labels: Some(to_map(&[
				("app.kubernetes.io/name", name),
				("app.kubernetes.io/component", "database"),
			])),
			annotations: Some(to_map(&[
				("prometheus.io/scrape", "true"),
				("prometheus.io/port", "9187"),
				("prometheus.io/path", "/metrics"),
			])),
			..Default::default()
		},
		spec: Some(ServiceSpec {
			cluster_ip: Some("None".into()),
			selector: Some(to_map(&[("cnpg.io/cluster", cluster_name)])),
			ports: Some(vec![ServicePort {
				name: Some("metrics".into()),
				port: 9187,
				target_port: Some(IntOrString::String("metrics".into())),
				protocol: Some("TCP".into()),
				..Default::default()
			}]),
			..Default::default()
		}),
		..Default::default()
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::params::Params;

	fn cfg(extra: Value) -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-abc",
			"cluster": {
				"fullName": "tamanu-internal-main",
				"backupsBucket": "backups-bucket",
				"backupsServiceAccountArn": "arn:aws:iam::123456789012:role/backups",
			},
			"config": extra,
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	fn args(cfg: &Config, name: &str) -> PgArgs {
		let (roles, sql) = reporting_roles(name);
		PgArgs::from_config(cfg, name, 2, roles, sql).unwrap()
	}

	fn find<'a>(out: &'a [Value], kind: &str) -> Option<&'a Value> {
		out.iter().find(|v| v["kind"] == kind)
	}

	#[test]
	fn renders_only_the_cluster_by_default() {
		let c = cfg(json!({}));
		let out = run_postgres(&c, args(&c, "central")).unwrap();
		assert_eq!(out.len(), 1);
		let cl = &out[0];
		assert_eq!(cl["metadata"]["name"], "central-db");
		assert_eq!(
			cl["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"],
			"0"
		);
		assert_eq!(cl["spec"]["storage"]["size"], "5Gi");
		assert!(cl["spec"].get("plugins").is_none());
		assert_eq!(
			cl["spec"]["serviceAccountTemplate"]["metadata"]["annotations"]["eks.amazonaws.com/role-arn"],
			"arn:aws:iam::123456789012:role/backups"
		);
	}

	#[test]
	fn backups_add_the_object_store_and_schedule() {
		let c = cfg(json!({ "backupsEnabled": true, "backupRetentionDays": 7 }));
		let out = run_postgres(&c, args(&c, "facility-1")).unwrap();
		let store = find(&out, "ObjectStore").unwrap();
		assert_eq!(store["metadata"]["name"], "facility-1-db-object-store");
		assert_eq!(store["spec"]["retentionPolicy"], "7d");
		assert_eq!(
			store["spec"]["configuration"]["destinationPath"],
			"s3://backups-bucket/main/facility-1-db/"
		);
		let sched = find(&out, "ScheduledBackup").unwrap();
		assert_eq!(sched["metadata"]["name"], "facility-1-db-scheduled");
		assert_eq!(sched["spec"]["cluster"]["name"], "facility-1-db");
		let plugin = &find(&out, "Cluster").unwrap()["spec"]["plugins"][0];
		assert_eq!(
			plugin["parameters"]["barmanObjectName"],
			"facility-1-db-object-store"
		);
	}

	#[test]
	fn backups_without_a_bucket_are_rejected() {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-abc",
			"cluster": { "fullName": "x" },
			"config": { "backupsEnabled": true },
		}))
		.unwrap();
		let c = Config::derive(&p).unwrap();
		assert!(PgArgs::from_config(&c, "central", 2, vec![], String::new()).is_err());
	}

	#[test]
	fn stack_role_overrides_the_cluster_role_and_bucket() {
		let c = cfg(json!({
			"backupsEnabled": true,
			"barmanRoleArn": "arn:aws:iam::123456789012:role/other",
			"barmanBucket": "other-bucket",
		}));
		let out = run_postgres(&c, args(&c, "central")).unwrap();
		let cl = find(&out, "Cluster").unwrap();
		assert_eq!(
			cl["spec"]["serviceAccountTemplate"]["metadata"]["annotations"]["eks.amazonaws.com/role-arn"],
			"arn:aws:iam::123456789012:role/other"
		);
		assert_eq!(
			find(&out, "ObjectStore").unwrap()["spec"]["configuration"]["destinationPath"],
			"s3://other-bucket/main/central-db/"
		);
	}

	#[test]
	fn colocation_and_pdb_follow_the_config() {
		let c = cfg(json!({ "dbAzColocate": false, "dbDisruptionBudgets": true }));
		let out = run_postgres(&c, args(&c, "central")).unwrap();
		let spec = &out[0]["spec"];
		assert_eq!(spec["enablePDB"], true);
		assert!(spec["affinity"].get("additionalPodAffinity").is_none());
	}

	#[test]
	fn dedicated_placement_pins_the_critical_pool() {
		let c = cfg(json!({}));
		let out = run_postgres_with(
			&c,
			args(&c, "central"),
			&PgOptions {
				placement: Placement::Dedicated,
				postgis: true,
				scrape_metrics: true,
				..Default::default()
			},
		)
		.unwrap();
		let cl = find(&out, "Cluster").unwrap();
		assert_eq!(
			cl["spec"]["affinity"]["nodeSelector"]["bes.node.group"],
			"db-critical"
		);
		assert_eq!(cl["spec"]["affinity"]["podAntiAffinityType"], "required");
		assert_eq!(
			cl["spec"]["imageCatalogRef"]["name"],
			"postgis-system-bookworm"
		);
		let svc = find(&out, "Service").unwrap();
		assert_eq!(svc["metadata"]["name"], "central-db-metrics");
		assert_eq!(svc["metadata"]["annotations"]["prometheus.io/port"], "9187");
	}

	#[test]
	fn rendering_is_deterministic() {
		let c = cfg(json!({ "backupsEnabled": true }));
		let a = run_postgres(&c, args(&c, "central")).unwrap();
		let b = run_postgres(&c, args(&c, "central")).unwrap();
		assert_eq!(a, b);
	}

	#[test]
	fn servers_read_the_connection_string_cnpg_publishes() {
		assert_eq!(names::DB_APP_URI_KEY, "uri");
		assert_eq!(names::db_app_secret("central"), "central-db-app");
	}
}
