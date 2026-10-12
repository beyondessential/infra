use serde_json::{Value, json};
use tamanu_render::config::Config;
use tamanu_render::params::Params;
use tamanu_render::postgres::cron::{CronJobArgs, cron_job};
use tamanu_render::postgres::{
	PgArgs, PgOptions, Placement, reporting_grants, reporting_roles, run_postgres,
	run_postgres_with,
};

fn cfg(extra_config: Value) -> Config {
	let p: Params = serde_json::from_value(json!({
		"stack": "main",
		"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
		"appVersion": "2.67.0",
		"cluster": {
			"fullName": "tamanu-internal-main",
			"backupsBucket": "example-backups",
			"backupsServiceAccountArn": "arn:aws:iam::123456789012:role/example-backups",
		},
		"config": extra_config,
	}))
	.unwrap();
	Config::derive(&p).unwrap()
}

fn args(cfg: &Config, server: &str, replicas: u32) -> PgArgs {
	let (roles, sql) = reporting_roles(server);
	PgArgs::from_config(cfg, server, replicas, roles, sql).unwrap()
}

fn yaml(resources: &[Value]) -> String {
	tamanu_render::to_yaml(resources).unwrap()
}

#[test]
fn central_database_with_reporting_grants() {
	let c = cfg(json!({ "dbStorage": "10Gi" }));
	let mut out = run_postgres(&c, args(&c, "central", 2)).unwrap();
	out.push(reporting_grants(&c, "central").unwrap());
	insta::assert_snapshot!(yaml(&out));
}

#[test]
fn facility_database_with_backups() {
	let c = cfg(json!({
		"backupsEnabled": true,
		"backupRetentionDays": 7,
		"dbAzColocate": false,
		"dbDisruptionBudgets": true,
	}));
	let out = run_postgres(&c, args(&c, "facility-2", 3)).unwrap();
	insta::assert_snapshot!(yaml(&out));
}

#[test]
fn dedicated_postgis_cluster_with_metrics_and_custom_tuning() {
	let c = cfg(json!({ "dbMemory": "8Gi", "dbStorage": "60Gi" }));
	let out = run_postgres_with(
		&c,
		args(&c, "central", 2),
		&PgOptions {
			postgis: true,
			placement: Placement::Dedicated,
			max_connections: 200,
			scrape_metrics: true,
			..Default::default()
		},
	)
	.unwrap();
	insta::assert_snapshot!(yaml(&out));
}

#[test]
fn cron_job_runs_psql_as_the_app_role() {
	let mut a = CronJobArgs::new("tamanu-main", "central", "0 3 * * *", "SELECT 1");
	a.labels.insert("app".into(), "example".into());
	insta::assert_snapshot!(yaml(&[cron_job("partition-example", a).unwrap()]));
}
