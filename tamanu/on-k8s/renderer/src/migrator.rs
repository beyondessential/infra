//! The migrator Job, ported from `common/migrator.ts`. It runs on every sync
//! after the database is healthy and before anything that needs the schema.

use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{PodSpec, PodTemplateSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::waves;

/// `pod` is the server's pod spec built for pod type `migrator` with the
/// command `migrate`. `server` is `central` or `facility-N`.
pub fn migrator(cfg: &Config, server: &str, mut pod: PodSpec) -> serde_json::Result<Value> {
	pod.restart_policy = Some("Never".into());
	let job = Job {
		metadata: ObjectMeta {
			name: Some(format!("{server}-migrator")),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(JobSpec {
			backoff_limit: Some(5),
			template: PodTemplateSpec {
				metadata: None,
				spec: Some(pod),
			},
			..Default::default()
		}),
		..Default::default()
	};
	Ok(waves::hook(serde_json::to_value(job)?, waves::MIGRATE))
}
