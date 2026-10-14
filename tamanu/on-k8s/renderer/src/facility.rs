//! Facility servers: API, tasks, FHIR, setup-sync, web frontend and ingress for
//! each facility. Ported from `facility/` in the `tamanu-on-k8s` Pulumi project.

mod spec;
mod workloads;

pub use spec::config_from_env;

use anyhow::Result;
use serde_json::Value;

use crate::blob_store::{BlobServer, blob_store_volume};
use crate::config::{Config, Facility};
use crate::pod::ImageType;
use crate::postgres::{self, PgArgs};
use crate::{gateway, migrator, waves, web};

use self::spec::{PodArgs, PodFactory};
use self::workloads::{Ctx, ServerType};

/// setupSync and startFhirWorker ship in Tamanu 2.60. Older release images
/// (standing envs pinned to old tags, auto-deploys of release branches) lack the
/// subcommands, so they keep the legacy config-based sync setup and skip the
/// seeding Job and the FHIR workers.
const FACILITY_SUBCOMMANDS_VERSION: &str = "2.60.0-0";

const FHIR_REFRESH_TOPICS: [&str; 3] = [
	"fhir.refresh.allFromUpstream",
	"fhir.refresh.entireResource",
	"fhir.refresh.fromUpstream",
];

pub fn render(cfg: &Config) -> Result<Vec<Value>> {
	let mut out = render_apps(cfg)?;
	for i in 0..cfg.facilities.len() {
		out.extend(database(cfg, &server_name(i))?);
	}
	Ok(out)
}

fn server_name(index: usize) -> String {
	format!("facility-{}", index + 1)
}

/// A facility's database cluster with its reporting roles and grants.
pub fn database(cfg: &Config, server: &str) -> Result<Vec<Value>> {
	let (roles, init_sql) = postgres::reporting_roles(server);
	let mut out = postgres::run_postgres(cfg, pg_args(cfg, server, roles, init_sql)?)?;
	out.push(postgres::reporting_grants(cfg, server)?);
	Ok(out)
}

fn pg_args(
	cfg: &Config,
	server: &str,
	roles: Vec<postgres::ManagedRole>,
	init_sql: String,
) -> Result<PgArgs> {
	PgArgs::from_config(cfg, server, cfg.replicas.facility.db, roles, init_sql)
}

/// Every facility's workloads, web frontend and ingress: everything but its
/// database.
pub fn render_apps(cfg: &Config) -> Result<Vec<Value>> {
	let mut out = Vec::new();
	for (i, facility) in cfg.facilities.iter().enumerate() {
		out.extend(facility_apps(cfg, &server_name(i), facility)?);
	}
	Ok(out)
}

/// One facility's apps. `server` is `facility-N`.
fn facility_apps(cfg: &Config, server: &str, facility: &Facility) -> Result<Vec<Value>> {
	let mut out = Vec::new();
	let device_id = facility.id.as_str();
	let replicas = cfg.replicas.facility;
	let has_subcommands = cfg.at_least_version(FACILITY_SUBCOMMANDS_VERSION);

	let blob_store = if cfg.shared_blob_storage {
		let store = blob_store_volume(cfg, server, BlobServer::Facility)?;
		out.push(store.claim.clone());
		Some(store)
	} else {
		None
	};
	let pods = PodFactory::new(cfg, server, blob_store.as_ref());
	let ctx = Ctx {
		cfg,
		server,
		device_id,
		pods: &pods,
	};

	out.push(migrator::migrator(
		cfg,
		server,
		pods.build(PodArgs {
			pod_type: "migrator",
			command: vec!["migrate".into()],
			..Default::default()
		}),
	)?);
	if has_subcommands {
		out.push(workloads::setup_sync(&ctx)?);
	}

	if replicas.tasks > 0 {
		out.push(workloads::run_tasks(&ctx)?);
		if has_subcommands {
			out.push(workloads::run_fhir_worker(
				&ctx,
				"refresh",
				&FHIR_REFRESH_TOPICS,
			)?);
			out.push(workloads::run_fhir_worker(
				&ctx,
				"resolver",
				&["fhir.resolver"],
			)?);
		}
	}

	out.extend(workloads::run_server(&ctx, ServerType::Sync, 1)?);
	out.extend(workloads::run_server(&ctx, ServerType::Api, replicas.api)?);

	for resource in web::run_web(
		cfg,
		web::WebArgs {
			name: server,
			server_type: ImageType::Facility,
			image_type: ImageType::Frontend,
			instance: Some(device_id),
			replicas: replicas.web,
		},
	)? {
		out.push(waves::in_wave(resource, waves::WORKLOADS));
	}

	let host = cfg
		.domains
		.facilities
		.get(&facility.host)
		.ok_or_else(|| anyhow::anyhow!("no domain for facility host {}", facility.host))?;
	out.extend(
		gateway::ingress(
			cfg,
			server,
			host,
			&format!("{server}-api"),
			&format!("{server}-web"),
		)?
		.into_iter()
		.map(|r| waves::in_wave(r, waves::WORKLOADS)),
	);

	Ok(out)
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::params::Params;

	fn cfg(config: serde_json::Value) -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-abc",
			"cluster": { "fullName": "tamanu-internal-main", "backupsBucket": "bucket" },
			"config": config,
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	#[test]
	fn each_facility_gets_its_own_cluster_sized_from_facility_replicas() {
		let cfg = cfg(json!({ "facilities": 2, "facilityDbReplicas": 3, "centralDbReplicas": 2 }));
		let (roles, init_sql) = postgres::reporting_roles("facility-2");
		let args = pg_args(&cfg, "facility-2", roles, init_sql).unwrap();
		assert_eq!(args.name, "facility-2");
		assert_eq!(args.replicas, 3);
		assert_eq!(args.roles.len(), 2);
		assert!(args.init_sql.contains("ALTER ROLE app CREATEROLE"));
	}

	#[test]
	fn the_database_renders_a_cluster_and_the_grants_job() {
		let out = database(&cfg(json!({ "facilities": 1 })), "facility-1").unwrap();
		let find = |kind: &str| out.iter().find(|r| r["kind"] == kind).unwrap();
		assert_eq!(find("Cluster")["metadata"]["name"], "facility-1-db");
		assert_eq!(
			find("Job")["metadata"]["name"],
			"facility-1-reporting-grants"
		);
	}

	#[test]
	fn servers_are_numbered_from_one() {
		assert_eq!(server_name(0), "facility-1");
		assert_eq!(server_name(2), "facility-3");
	}

	#[test]
	fn every_facility_has_a_database_and_apps() {
		let out = render(&cfg(json!({ "facilities": 3 }))).unwrap();
		for n in 1..=3 {
			let name = format!("facility-{n}-db");
			assert!(
				out.iter()
					.any(|r| r["kind"] == "Cluster" && r["metadata"]["name"] == name)
			);
		}
	}
}
