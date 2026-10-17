//! A suspended CronJob that wakes a hibernated deployment, to be run from the
//! Argo CD UI.
//!
//! The TTL schedule is the stub's, so it is not in Argo CD's resource tree. This
//! CronJob is: its "Create Job" action runs the same steps as the Job the stub
//! runs on every update. The CronJob is suspended, so it never runs by itself.
//! A woken deployment is not given a new time to live; only an update does that.

use std::collections::BTreeMap;

use anyhow::Result;
use k8s_openapi::api::batch::v1::{CronJob, CronJobSpec, JobSpec, JobTemplateSpec};
use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec, ResourceRequirements};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::pod::spot_toleration;
use crate::{names, waves};

pub const NAME: &str = "wake";

const KUBECTL_IMAGE: &str = "registry.k8s.io/kubectl:v1.34.7";

fn kubectl(name: &str, args: &[&str], namespace: &str) -> Container {
	let mut all: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
	all.extend(["-n".into(), namespace.into()]);
	Container {
		name: name.into(),
		image: Some(KUBECTL_IMAGE.into()),
		command: Some(vec!["kubectl".into()]),
		args: Some(all),
		resources: Some(ResourceRequirements {
			requests: Some(BTreeMap::from([
				("cpu".into(), Quantity("10m".into())),
				("memory".into(), Quantity("32Mi".into())),
			])),
			limits: Some(BTreeMap::from([(
				"memory".into(),
				Quantity("128Mi".into()),
			)])),
			..Default::default()
		}),
		..Default::default()
	}
}

// spec: K8STSD#waking
pub fn wake(cfg: &Config) -> Result<Vec<Value>> {
	if !cfg.has_ttl {
		return Ok(vec![]);
	}
	let ns = cfg.namespace.as_str();

	let cron_job = CronJob {
		metadata: ObjectMeta {
			name: Some(NAME.into()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: CronJobSpec {
			// Never due: it only ever runs when someone creates a Job from it.
			schedule: "0 0 1 1 *".into(),
			suspend: Some(true),
			concurrency_policy: Some("Forbid".into()),
			successful_jobs_history_limit: Some(1),
			failed_jobs_history_limit: Some(3),
			job_template: JobTemplateSpec {
				metadata: None,
				spec: Some(JobSpec {
					backoff_limit: Some(2),
					ttl_seconds_after_finished: Some(600),
					template: PodTemplateSpec {
						metadata: None,
						spec: Some(PodSpec {
							service_account_name: Some(names::TTL_SERVICE_ACCOUNT.into()),
							restart_policy: Some("Never".into()),
							tolerations: Some(vec![spot_toleration()]),
							containers: vec![
								kubectl(
									"wake-deployments",
									&[
										"annotate",
										"deployment",
										"--all",
										"downscaler/force-downtime-",
										"--overwrite",
									],
									ns,
								),
								kubectl(
									"wake-cnpg",
									&[
										"annotate",
										"cluster.postgresql.cnpg.io",
										"--all",
										"cnpg.io/hibernation=off",
										"--overwrite",
									],
									ns,
								),
							],
							..Default::default()
						}),
					},
					..Default::default()
				}),
			},
			..Default::default()
		},
		..Default::default()
	};

	Ok(vec![waves::in_wave(
		serde_json::to_value(cron_job)?,
		waves::WORKLOADS,
	)])
}
