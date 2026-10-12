//! The provisioner Job, ported from `central/provisioner.ts`. The provisioning
//! ConfigMap it reads is rendered with the other templated config.

use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{ConfigMapVolumeSource, PodTemplateSpec, Volume, VolumeMount};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::pod::ContainerArgs;
use crate::{names, waves};

use super::specs::{PodArgs, PodSpecFactory};

const VOLUME_NAME: &str = "provisioning-volume";
const MOUNT_PATH: &str = "/provisioning";

pub fn provisioner(cfg: &Config, pods: &PodSpecFactory<'_>) -> serde_json::Result<Value> {
	let mut args = PodArgs::new(
		"provisioner",
		[
			"provision",
			"--skip-if-not-needed",
			"/provisioning/provisioning.json5",
		],
	);
	args.container = ContainerArgs {
		volume_mounts: vec![VolumeMount {
			name: VOLUME_NAME.into(),
			mount_path: MOUNT_PATH.into(),
			..Default::default()
		}],
		..Default::default()
	};
	args.volumes = vec![Volume {
		name: VOLUME_NAME.into(),
		config_map: Some(ConfigMapVolumeSource {
			name: names::PROVISIONING_CONFIG.into(),
			..Default::default()
		}),
		..Default::default()
	}];

	let mut pod = pods.pod_spec(args);
	pod.restart_policy = Some("Never".into());

	let job = Job {
		metadata: ObjectMeta {
			name: Some("central-provisioner".into()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(JobSpec {
			backoff_limit: Some(2),
			template: PodTemplateSpec {
				metadata: None,
				spec: Some(pod),
			},
			..Default::default()
		}),
		..Default::default()
	};
	Ok(waves::hook(serde_json::to_value(job)?, waves::PROVISION))
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::central::test_support::cfg;

	#[test]
	fn provisions_from_the_provisioning_config() {
		let cfg = cfg(json!({}));
		let pods = PodSpecFactory::new(&cfg, None);
		let job = provisioner(&cfg, &pods).unwrap();
		let pod = &job["spec"]["template"]["spec"];
		assert_eq!(job["spec"]["backoffLimit"], 2);
		assert_eq!(pod["restartPolicy"], "Never");
		assert_eq!(pod["containers"][0]["name"], "provisioner");
		assert_eq!(
			pod["containers"][0]["args"],
			json!([
				"provision",
				"--skip-if-not-needed",
				"/provisioning/provisioning.json5"
			])
		);
		assert_eq!(
			pod["volumes"][2]["configMap"]["name"],
			names::PROVISIONING_CONFIG
		);
		assert_eq!(
			job["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"],
			waves::PROVISION.to_string()
		);
		assert_eq!(
			job["metadata"]["annotations"]["argocd.argoproj.io/hook"],
			"Sync"
		);
	}
}
