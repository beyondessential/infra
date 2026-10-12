//! A CronJob that runs one `psql` statement against a CNPG cluster as the app
//! role, ported from `postgresCron.ts`.

use std::collections::BTreeMap;

use anyhow::Result;
use k8s_openapi::api::batch::v1::{CronJob, CronJobSpec, JobSpec, JobTemplateSpec};
use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec, ResourceRequirements};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Architecture;
use crate::names;
use crate::pod::{env, env_secret, spot_toleration, workload_affinity_for};
use crate::postgres::DEFAULT_POSTGRES_VERSION;

pub struct CronJobArgs {
	pub namespace: String,
	pub schedule: String,
	/// The SQL statement, passed to `psql -c`.
	pub command: String,
	/// The server the job connects to. Its read-write service is `PGHOST` and
	/// the app password comes from its URL Secret.
	pub server: String,
	pub db_name: String,
	pub db_user: String,
	pub architecture: Architecture,
	pub labels: BTreeMap<String, String>,
	pub backoff_limit: i32,
	pub postgres_version: u32,
	pub resources: ResourceRequirements,
}

impl CronJobArgs {
	pub fn new(namespace: &str, server: &str, schedule: &str, command: &str) -> Self {
		let quantities = |cpu: &str, memory: &str| {
			BTreeMap::from([
				("cpu".to_owned(), Quantity(cpu.into())),
				("memory".to_owned(), Quantity(memory.into())),
			])
		};
		Self {
			namespace: namespace.into(),
			schedule: schedule.into(),
			command: command.into(),
			server: server.into(),
			db_name: "app".into(),
			db_user: "app".into(),
			architecture: Architecture::Arm64,
			labels: BTreeMap::new(),
			// These pods prefer spot and run a single short statement, so a bad
			// spot window can burn several attempts in a row without the
			// statement ever reaching the database. The work is idempotent and
			// retries cost 10m CPU, so allow enough of them to ride one out.
			backoff_limit: 10,
			postgres_version: DEFAULT_POSTGRES_VERSION,
			resources: ResourceRequirements {
				requests: Some(quantities("10m", "32Mi")),
				limits: Some(quantities("100m", "128Mi")),
				..Default::default()
			},
		}
	}
}

pub fn cron_job(name: &str, args: CronJobArgs) -> Result<Value> {
	let labels = Some(args.labels).filter(|l| !l.is_empty());
	let pod = PodSpec {
		tolerations: Some(vec![spot_toleration()]),
		affinity: Some(workload_affinity_for(args.architecture)),
		restart_policy: Some("Never".into()),
		containers: vec![Container {
			name: name.into(),
			image: Some(format!("postgres:{}", args.postgres_version)),
			command: Some(vec!["psql".into()]),
			args: Some(vec!["-c".into(), args.command]),
			env: Some(vec![
				env("PGDATABASE", args.db_name),
				env("PGHOST", names::db_rw_service(&args.server)),
				env("PGUSER", args.db_user),
				env_secret(
					"PGPASSWORD",
					&names::db_app_secret(&args.server),
					"password",
				),
			]),
			resources: Some(args.resources),
			..Default::default()
		}],
		..Default::default()
	};

	let cron = CronJob {
		metadata: ObjectMeta {
			name: Some(name.into()),
			namespace: Some(args.namespace),
			labels: labels.clone(),
			..Default::default()
		},
		spec: CronJobSpec {
			schedule: args.schedule,
			job_template: JobTemplateSpec {
				metadata: Some(ObjectMeta {
					labels: labels.clone(),
					..Default::default()
				}),
				spec: Some(JobSpec {
					backoff_limit: Some(args.backoff_limit),
					template: PodTemplateSpec {
						metadata: Some(ObjectMeta {
							labels,
							..Default::default()
						}),
						spec: Some(pod),
					},
					..Default::default()
				}),
			},
			..Default::default()
		},
		..Default::default()
	};
	Ok(serde_json::to_value(cron)?)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_the_app_password_from_the_cnpg_secret() {
		let job = cron_job(
			"partition-statuses",
			CronJobArgs::new("ns", "central", "0 3 * * *", "SELECT 1"),
		)
		.unwrap();
		let c = &job["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0];
		assert_eq!(c["image"], "postgres:18");
		assert_eq!(c["args"][1], "SELECT 1");
		let secret = &c["env"][3]["valueFrom"]["secretKeyRef"];
		assert_eq!(secret["name"], "central-db-app");
		assert_eq!(secret["key"], "password");
		assert_eq!(c["env"][1]["value"], "central-db-rw");
	}

	#[test]
	fn empty_labels_are_omitted() {
		let job = cron_job(
			"x",
			CronJobArgs::new("ns", "central", "* * * * *", "SELECT 1"),
		)
		.unwrap();
		assert!(job["metadata"].get("labels").is_none());
	}
}
