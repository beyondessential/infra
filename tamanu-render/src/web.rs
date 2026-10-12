//! Web frontend Deployment and Service, ported from `web/frontend.ts`.

use anyhow::Result;
use k8s_openapi::api::apps::v1::{Deployment, DeploymentSpec};
use k8s_openapi::api::core::v1::{
	ContainerPort, HTTPGetAction, PodTemplateSpec, Probe, Service, ServicePort, ServiceSpec,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::Value;

use crate::config::Config;
use crate::meta::{app_labels, app_selector, cost_labels};
use crate::pod::{ContainerArgs, ImageType, PodSpecArgs, env, web_pod_spec};

pub struct WebArgs<'a> {
	pub name: &'a str,
	/// Names the app in labels and selectors.
	pub server_type: ImageType,
	/// Picks the image. Central and facility serve the shared frontend image.
	pub image_type: ImageType,
	pub instance: Option<&'a str>,
	pub replicas: u32,
}

pub fn run_web(cfg: &Config, args: WebArgs<'_>) -> Result<Vec<Value>> {
	let WebArgs {
		name,
		server_type,
		image_type,
		instance,
		replicas,
	} = args;
	let selector = app_selector(server_type, "web", instance);
	let http_get = |path: &str| HTTPGetAction {
		path: Some(path.into()),
		port: IntOrString::Int(3000),
		..Default::default()
	};

	let service = Service {
		metadata: ObjectMeta {
			name: Some(format!("{name}-web")),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(ServiceSpec {
			ports: Some(vec![ServicePort {
				protocol: Some("TCP".into()),
				port: 80,
				target_port: Some(IntOrString::String("http".into())),
				name: Some("http".into()),
				..Default::default()
			}]),
			selector: Some(selector.clone()),
			cluster_ip: Some("None".into()),
			..Default::default()
		}),
		..Default::default()
	};

	let mut labels = app_labels(cfg, server_type, "web", instance);
	labels.extend(cost_labels(cfg));

	let pod = web_pod_spec(
		cfg,
		image_type,
		PodSpecArgs {
			pod_type: "http".into(),
			env: vec![env("PORT", "3000")],
			volumes: vec![],
			container: ContainerArgs {
				ports: vec![ContainerPort {
					container_port: 3000,
					name: Some("http".into()),
					..Default::default()
				}],
				// Wait up to 60 seconds for the server to start...
				startup_probe: Some(Probe {
					period_seconds: Some(1),
					failure_threshold: Some(60),
					http_get: Some(http_get("/")),
					..Default::default()
				}),
				// ...then continuously check it is up, and restart if it fails.
				liveness_probe: Some(Probe {
					period_seconds: Some(10),
					failure_threshold: Some(2),
					http_get: Some(http_get("/")),
					..Default::default()
				}),
				volume_mounts: vec![],
			},
		},
	);

	let deployment = Deployment {
		metadata: ObjectMeta {
			name: Some(format!("{name}-web")),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(DeploymentSpec {
			replicas: Some(replicas as i32),
			selector: LabelSelector {
				match_labels: Some(selector),
				match_expressions: None,
			},
			template: PodTemplateSpec {
				metadata: Some(ObjectMeta {
					labels: Some(labels),
					..Default::default()
				}),
				spec: Some(pod),
			},
			..Default::default()
		}),
		..Default::default()
	};

	Ok(vec![
		serde_json::to_value(service)?,
		serde_json::to_value(deployment)?,
	])
}
