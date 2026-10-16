//! The API Service and Deployment, ported from `central/api.ts`.

use k8s_openapi::api::core::v1::{
	ContainerPort, HTTPGetAction, Probe, Service, ServicePort, ServiceSpec,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::Value;

use crate::config::Config;
use crate::pod::{ContainerArgs, env, synthetic_api_env};
use crate::scheduling::replica_disruption_budget;
use crate::waves;

use super::specs::{PodArgs, PodSpecFactory, deployment, labels, selector};

const COMPONENT: &str = "api-server";

/// What the ingress and the other servers reach the API by.
pub fn service_name() -> String {
	"central-api".into()
}

pub fn api(cfg: &Config, pods: &PodSpecFactory<'_>) -> serde_json::Result<Vec<Value>> {
	let service = Service {
		metadata: ObjectMeta {
			name: Some(service_name()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(ServiceSpec {
			// Prefer same-zone endpoints; cross-AZ traffic is billed.
			traffic_distribution: Some("PreferClose".into()),
			ports: Some(vec![ServicePort {
				protocol: Some("TCP".into()),
				port: 80,
				target_port: Some(IntOrString::String("http".into())),
				name: Some("http".into()),
				..Default::default()
			}]),
			selector: Some(selector(COMPONENT)),
			..Default::default()
		}),
		..Default::default()
	};

	let http_get = || HTTPGetAction {
		path: Some("/".into()),
		port: IntOrString::Int(3000),
		..Default::default()
	};
	let mut args = PodArgs::new("server", ["serve"]);
	args.env = vec![env("PORT", "3000")];
	args.env.extend(synthetic_api_env(cfg));
	args.spread = Some(labels(cfg, COMPONENT));
	args.container = ContainerArgs {
		ports: vec![ContainerPort {
			container_port: 3000,
			name: Some("http".into()),
			..Default::default()
		}],
		// Wait up to 60 seconds for the server to start...
		// spec: TDR#server-health
		startup_probe: Some(Probe {
			period_seconds: Some(1),
			failure_threshold: Some(60),
			http_get: Some(http_get()),
			..Default::default()
		}),
		// ...then continuously check it is up, and restart if it fails.
		liveness_probe: Some(Probe {
			period_seconds: Some(10),
			failure_threshold: Some(2),
			http_get: Some(http_get()),
			..Default::default()
		}),
		volume_mounts: vec![],
	};

	Ok(vec![
		waves::in_wave(serde_json::to_value(service)?, waves::WORKLOADS),
		deployment(
			cfg,
			"central-api",
			COMPONENT,
			cfg.replicas.central.api,
			false,
			pods.pod_spec(args),
		)?,
		replica_disruption_budget(cfg, &service_name(), selector(COMPONENT))?,
	])
}
