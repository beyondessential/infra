//! The synthetic tests Deployment, ported from `syntheticTests.ts`.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use k8s_openapi::api::apps::v1::{Deployment, DeploymentSpec};
use k8s_openapi::api::core::v1::{Container, PodSpec, PodTemplateSpec, ResourceRequirements};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use serde_json::Value;

use crate::config::Config;
use crate::meta::{Labels, cost_labels};
use crate::pod::env;
use crate::scheduling::workload_scheduling;
use crate::waves;

const NAME: &str = "synthetic-tests";

fn quantities(cpu: &str, memory: &str) -> BTreeMap<String, Quantity> {
	BTreeMap::from([
		("cpu".into(), Quantity(cpu.into())),
		("memory".into(), Quantity(memory.into())),
	])
}

/// An artillery load test aimed at the central server and each facility
/// server, or nothing when synthetic tests are off.
pub fn synthetic_tests(cfg: &Config) -> Result<Vec<Value>> {
	if !cfg.synthetic_tests {
		return Ok(vec![]);
	}

	let central = format!("https://{}", cfg.domains.central);
	let facilities = cfg
		.facilities
		.iter()
		.map(|facility| {
			cfg.domains
				.facilities
				.get(&facility.host)
				.map(|host| format!("https://{host}"))
				.with_context(|| format!("no domain for facility host {}", facility.host))
		})
		.collect::<Result<Vec<_>>>()?
		.join(",");

	let selector = Labels::from([
		("app.kubernetes.io/name".into(), NAME.into()),
		("app.kubernetes.io/component".into(), "artillery".into()),
	]);
	let mut labels = selector.clone();
	labels.insert("app.kubernetes.io/version".into(), cfg.image_tag.clone());
	labels.extend(cost_labels(cfg));

	let scheduling = workload_scheduling(cfg, None);
	let deployment = Deployment {
		metadata: ObjectMeta {
			name: Some(NAME.into()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(DeploymentSpec {
			replicas: Some(1),
			selector: LabelSelector {
				match_labels: Some(selector),
				match_expressions: None,
			},
			template: PodTemplateSpec {
				metadata: Some(ObjectMeta {
					labels: Some(labels),
					..Default::default()
				}),
				spec: Some(PodSpec {
					tolerations: scheduling.tolerations,
					affinity: Some(scheduling.affinity),
					topology_spread_constraints: scheduling.topology_spread_constraints,
					containers: vec![Container {
						name: "artillery".into(),
						image: Some(format!(
							"ghcr.io/beyondessential/tamanu-synthetic-tests:{}",
							cfg.image_tag
						)),
						env: Some(vec![
							env("CENTRAL_TARGETS", central),
							env("FACILITY_TARGETS", facilities),
						]),
						resources: Some(ResourceRequirements {
							requests: Some(quantities("50m", "128Mi")),
							limits: Some(quantities("500m", "512Mi")),
							..Default::default()
						}),
						..Default::default()
					}],
					..Default::default()
				}),
			},
			..Default::default()
		}),
		..Default::default()
	};

	Ok(vec![waves::in_wave(
		serde_json::to_value(deployment)?,
		waves::WORKLOADS,
	)])
}
