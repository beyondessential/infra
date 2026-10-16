//! Central's database: the CNPG cluster, with the reporting roles and grants.

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;
use crate::postgres::{self, PgArgs, run_postgres};

use super::SERVER;

pub fn render(cfg: &Config) -> Result<Vec<Value>> {
	let (roles, init_sql) = postgres::reporting_roles(cfg, SERVER);
	let mut out = run_postgres(cfg, pg_args(cfg, roles, init_sql)?)?;
	out.push(postgres::reporting_grants(cfg, SERVER)?);
	Ok(out)
}

pub fn pg_args(
	cfg: &Config,
	roles: Vec<postgres::ManagedRole>,
	init_sql: String,
) -> Result<PgArgs> {
	let mut args = PgArgs::from_config(cfg, SERVER, cfg.replicas.central.db, roles, init_sql)?;
	args.seed_snapshot = cfg.seed_snapshot_name.clone();
	Ok(args)
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::central::test_support::{cfg, cfg_at};

	#[test]
	fn the_cluster_is_named_and_sized_for_central() {
		let cfg = cfg(json!({ "dbStorage": "10Gi", "centralDbReplicas": 3 }));
		let (roles, init_sql) = postgres::reporting_roles(&cfg, SERVER);
		let args = pg_args(&cfg, roles, init_sql).unwrap();
		assert_eq!(args.name, "central");
		assert_eq!(args.replicas, 3);
		assert_eq!(args.storage, "10Gi");
		assert!(args.init_sql.contains("ALTER ROLE app CREATEROLE"));
	}

	#[test]
	fn the_legacy_roles_are_managed_only_before_2_60() {
		let old = cfg_at(Some("2.59.0"));
		assert!(old.has_legacy_report_roles());
		let out = render(&old).unwrap();
		assert_eq!(
			out[0]["spec"]["managed"]["roles"].as_array().unwrap().len(),
			2
		);

		let new = cfg_at(Some("2.60.0"));
		assert!(!new.has_legacy_report_roles());
		let out = render(&new).unwrap();
		assert!(out[0]["spec"].get("managed").is_none());
		assert!(
			out.iter()
				.any(|r| r["metadata"]["name"] == "central-reporting-grants")
		);
	}
}
