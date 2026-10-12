//! Central's database: the CNPG cluster, with the reporting roles and grants.

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;
use crate::postgres::{self, PgArgs, run_postgres};

use super::SERVER;

pub fn render(cfg: &Config) -> Result<Vec<Value>> {
	let (roles, init_sql) = postgres::reporting_roles(SERVER);
	let mut out = run_postgres(cfg, pg_args(cfg, roles, init_sql)?)?;
	out.push(postgres::reporting_grants(cfg, SERVER)?);
	Ok(out)
}

pub fn pg_args(
	cfg: &Config,
	roles: Vec<postgres::ManagedRole>,
	init_sql: String,
) -> Result<PgArgs> {
	PgArgs::from_config(cfg, SERVER, cfg.replicas.central.db, roles, init_sql)
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::central::test_support::cfg;

	#[test]
	fn the_cluster_is_named_and_sized_for_central() {
		let cfg = cfg(json!({ "dbStorage": "10Gi", "centralDbReplicas": 3 }));
		let (roles, init_sql) = postgres::reporting_roles(SERVER);
		let args = pg_args(&cfg, roles, init_sql).unwrap();
		assert_eq!(args.name, "central");
		assert_eq!(args.replicas, 3);
		assert_eq!(args.storage, "10Gi");
		assert_eq!(args.roles.len(), 2);
		assert!(args.init_sql.contains("ALTER ROLE app CREATEROLE"));
	}
}
