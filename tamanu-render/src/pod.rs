//! Pod spec factory for the web frontends, ported from `web/specs.ts`.

use std::collections::BTreeMap;

use k8s_openapi::api::core::v1::{
	Affinity, Container, ContainerPort, EnvVar, EnvVarSource, NodeAffinity, NodeSelector,
	NodeSelectorRequirement, NodeSelectorTerm, PodSpec, PreferredSchedulingTerm, Probe,
	ResourceRequirements, SecretKeySelector, Toleration, Volume, VolumeMount,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;

use crate::config::Config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageType {
	Central,
	Facility,
	Frontend,
	PatientPortal,
}

impl ImageType {
	pub fn as_str(self) -> &'static str {
		match self {
			Self::Central => "central",
			Self::Facility => "facility",
			Self::Frontend => "frontend",
			Self::PatientPortal => "patient-portal",
		}
	}

	pub fn image(self, cfg: &Config) -> String {
		format!(
			"ghcr.io/beyondessential/tamanu-{}:{}",
			self.as_str(),
			cfg.image_tag
		)
	}
}

pub fn env(name: &str, value: impl Into<String>) -> EnvVar {
	EnvVar {
		name: name.into(),
		value: Some(value.into()),
		value_from: None,
	}
}

pub fn env_secret(name: &str, secret: &str, key: &str) -> EnvVar {
	EnvVar {
		name: name.into(),
		value: None,
		value_from: Some(EnvVarSource {
			secret_key_ref: Some(SecretKeySelector {
				name: secret.into(),
				key: key.into(),
				optional: None,
			}),
			..Default::default()
		}),
	}
}

fn requirement(key: &str, value: &str) -> NodeSelectorRequirement {
	NodeSelectorRequirement {
		key: key.into(),
		operator: "In".into(),
		values: Some(vec![value.into()]),
	}
}

/// Spot nodes are preferred and tolerated, but the workload pool and the
/// configured architecture are required.
pub fn workload_affinity(cfg: &Config) -> Affinity {
	workload_affinity_for(cfg.architecture)
}

/// [`workload_affinity`] for a workload that picks its own architecture.
pub fn workload_affinity_for(architecture: crate::config::Architecture) -> Affinity {
	Affinity {
		node_affinity: Some(NodeAffinity {
			preferred_during_scheduling_ignored_during_execution: Some(vec![
				PreferredSchedulingTerm {
					weight: 1,
					preference: NodeSelectorTerm {
						match_expressions: Some(vec![requirement("bes.node.schedule", "spot")]),
						match_fields: None,
					},
				},
			]),
			required_during_scheduling_ignored_during_execution: Some(NodeSelector {
				node_selector_terms: vec![NodeSelectorTerm {
					match_expressions: Some(vec![
						requirement("bes.node.arch", architecture.as_str()),
						requirement("bes.node.purpose", "workload"),
					]),
					match_fields: None,
				}],
			}),
		}),
		..Default::default()
	}
}

pub fn spot_toleration() -> Toleration {
	Toleration {
		key: Some("spotInstance".into()),
		operator: Some("Equal".into()),
		value: Some("true".into()),
		effect: Some("PreferNoSchedule".into()),
		toleration_seconds: None,
	}
}

#[derive(Default)]
pub struct ContainerArgs {
	pub ports: Vec<ContainerPort>,
	pub startup_probe: Option<Probe>,
	pub liveness_probe: Option<Probe>,
	pub volume_mounts: Vec<VolumeMount>,
}

#[derive(Default)]
pub struct PodSpecArgs {
	pub pod_type: String,
	pub env: Vec<EnvVar>,
	pub volumes: Vec<Volume>,
	pub container: ContainerArgs,
}

pub fn web_pod_spec(cfg: &Config, image_type: ImageType, args: PodSpecArgs) -> PodSpec {
	let mut env = args.env;
	env.push(self::env("NODE_ENV", &cfg.node_env));
	if let Some(sha) = cfg.image_tag.strip_prefix("sha-") {
		env.push(self::env(
			"REVISION",
			sha.chars().take(10).collect::<String>(),
		));
	}
	env.push(env_secret("BUGSNAG_API_KEY", "bugsnag", "apiKey"));

	let quantity = |s: &str| Quantity(s.into());
	let resources = ResourceRequirements {
		requests: Some(BTreeMap::from([
			("cpu".into(), quantity("1m")),
			("memory".into(), quantity("10Mi")),
		])),
		// No CPU limit: a 10m quota throttled asset serving in ~12% of periods.
		limits: Some(BTreeMap::from([("memory".into(), quantity("100Mi"))])),
		..Default::default()
	};

	PodSpec {
		tolerations: Some(vec![spot_toleration()]),
		affinity: Some(workload_affinity(cfg)),
		volumes: Some(args.volumes).filter(|v| !v.is_empty()),
		containers: vec![Container {
			name: args.pod_type,
			image: Some(image_type.image(cfg)),
			image_pull_policy: Some("IfNotPresent".into()),
			volume_mounts: Some(args.container.volume_mounts).filter(|v| !v.is_empty()),
			env: Some(env),
			resources: Some(resources),
			ports: Some(args.container.ports).filter(|v| !v.is_empty()),
			startup_probe: args.container.startup_probe,
			liveness_probe: args.container.liveness_probe,
			..Default::default()
		}],
		..Default::default()
	}
}

/// One-shot pods (migrations, provisioning) can legitimately use far more
/// memory than a server at steady state, so only long-running pods get a
/// memory limit.
pub fn app_memory_limit(pod_type: &str) -> Option<BTreeMap<String, Quantity>> {
	const ONE_SHOT: [&str; 4] = ["migrator", "provisioner", "seed-top-up", "setup-sync"];
	(!ONE_SHOT.contains(&pod_type))
		.then(|| BTreeMap::from([("memory".into(), Quantity("1Gi".into()))]))
}
