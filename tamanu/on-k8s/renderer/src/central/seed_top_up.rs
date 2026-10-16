//! The seed top-up Job, ported from `central/seedTopUp.ts`.

use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::PodTemplateSpec;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::config::Config;
use crate::pod::env;
use crate::waves;

use super::specs::{PodArgs, PodSpecFactory};

const ROUNDS: u32 = 3;

/// The first Tamanu release with `generate seed`. A release branch cut before
/// it has no such subcommand, so the Job would exit 1 and fail the sync; those
/// stacks keep whatever data the restored snapshot came with.
const MIN_VERSION: &str = "2.65.0-0";

// spec: TDR#seed-top-up
fn job_name(image_tag: &str) -> String {
	let digest = Sha256::digest(image_tag.as_bytes());
	let suffix: String = digest[..4].iter().map(|b| format!("{b:02x}")).collect();
	format!("central-seed-top-up-{suffix}")
}

/// A seed snapshot holds only the data types its own version's generator knew
/// about, so anything added since has no rows until this runs against the
/// restored database.
///
/// Each run adds more fake records, so it must run once per image and not on
/// every sync. The Job is named by the image tag and is an ordinary resource:
/// an unchanged image leaves it alone, and a new one creates a new Job and
/// prunes the old. It must not be given a time to live, or Argo would create it
/// again once it was cleaned up.
pub fn seed_top_up(cfg: &Config, pods: &PodSpecFactory<'_>) -> serde_json::Result<Option<Value>> {
	if !cfg.seed_snapshot || !cfg.at_least_version(MIN_VERSION) {
		return Ok(None);
	}

	let mut args = PodArgs::new(
		"seed-top-up",
		["generate", "seed", "--rounds", &ROUNDS.to_string()],
	);
	// The command refuses to write fake data without this, since the same image
	// runs on hospital servers.
	args.env = vec![env("TAMANU_ALLOW_FAKE_DATA", "true")];

	let mut pod = pods.pod_spec(args);
	pod.restart_policy = Some("Never".into());

	let job = Job {
		metadata: ObjectMeta {
			name: Some(job_name(&cfg.image_tag)),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(JobSpec {
			backoff_limit: Some(1),
			template: PodTemplateSpec {
				metadata: None,
				spec: Some(pod),
			},
			..Default::default()
		}),
		..Default::default()
	};
	Ok(Some(waves::in_wave(
		serde_json::to_value(job)?,
		waves::WORKLOADS,
	)))
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::params::Params;

	fn job(config: Value, version: &str) -> Option<Value> {
		let params: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
			"appVersion": version,
			"cluster": { "fullName": "example-main" },
			"config": config,
		}))
		.unwrap();
		let cfg = Config::derive(&params).unwrap();
		let pods = PodSpecFactory::new(&cfg, None);
		seed_top_up(&cfg, &pods).unwrap()
	}

	#[test]
	fn runs_after_the_sync_with_the_fake_data_override() {
		let job = job(
			json!({ "seedSnapshot": true, "nodeEnv": "staging" }),
			"2.67.0",
		)
		.unwrap();
		let container = &job["spec"]["template"]["spec"]["containers"][0];
		assert_eq!(
			container["args"],
			json!(["generate", "seed", "--rounds", "3"])
		);
		assert!(
			container["env"]
				.as_array()
				.unwrap()
				.iter()
				.any(|e| e["name"] == "TAMANU_ALLOW_FAKE_DATA" && e["value"] == "true")
		);
		assert!(job["metadata"]["annotations"]["argocd.argoproj.io/hook"].is_null());
		assert!(job["spec"].get("ttlSecondsAfterFinished").is_none());
	}

	#[test]
	fn is_named_by_the_image_so_it_runs_once_per_image() {
		assert_eq!(job_name("sha-aaa"), job_name("sha-aaa"));
		assert_ne!(job_name("sha-aaa"), job_name("sha-bbb"));
		assert!(job_name("sha-aaa").starts_with("central-seed-top-up-"));
	}

	#[test]
	fn is_not_run_without_the_option_or_before_the_subcommand_exists() {
		assert!(job(json!({ "nodeEnv": "staging" }), "2.67.0").is_none());
		assert!(
			job(
				json!({ "seedSnapshot": true, "nodeEnv": "staging" }),
				"2.64.0"
			)
			.is_none()
		);
	}
}
