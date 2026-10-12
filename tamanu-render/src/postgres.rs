//! CloudNativePG cluster for one Tamanu server, ported from `runPostgres` in
//! `common/k8s/postgres.ts` and its tuning, cron and URL helpers.

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;

pub struct BarmanBackup {
	pub bucket: String,
	pub deploy_name: String,
	pub retention_days: u32,
}

pub struct ManagedRole {
	pub name: String,
	pub password_secret: String,
	pub login: bool,
}

pub struct PgArgs {
	/// `central` or `facility-N`. The cluster is named `{name}-db`.
	pub name: String,
	pub replicas: u32,
	pub storage: String,
	pub timezone: String,
	pub roles: Vec<ManagedRole>,
	pub init_sql: String,
	pub inherited_metadata_labels: std::collections::BTreeMap<String, String>,
	pub barman_role_arn: Option<String>,
	pub barman_backup: Option<BarmanBackup>,
	pub colocate_az: bool,
	pub disruption_budgets: bool,
	pub memory_request: Option<String>,
}

pub fn run_postgres(_cfg: &Config, _args: PgArgs) -> Result<Vec<Value>> {
	todo!("port runPostgres")
}
