//! The facility's long-running and one-shot processes, ported from
//! `facility/server.ts`, `tasks.ts`, `fhir.ts` and the setup-sync Job in
//! `FacilityServer.ts`.

use anyhow::{Result, anyhow};
use k8s_openapi::api::apps::v1::{Deployment, DeploymentSpec, DeploymentStrategy};
use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{
	ContainerPort, HTTPGetAction, PodSpec, PodTemplateSpec, Probe, Service, ServicePort,
	ServiceSpec,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::Value;

use crate::config::Config;
use crate::config_map;
use crate::meta::{app_labels, app_selector, cost_labels};
use crate::pod::{ContainerArgs, ImageType, env};
use crate::waves;

use super::spec::{PodArgs, PodFactory};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerType {
	Api,
	Sync,
}

impl ServerType {
	fn as_str(self) -> &'static str {
		match self {
			Self::Api => "api",
			Self::Sync => "sync",
		}
	}

	fn command(self) -> &'static str {
		match self {
			Self::Api => "startApi",
			Self::Sync => "startSync",
		}
	}

	fn strategy(self) -> &'static str {
		match self {
			Self::Api => "RollingUpdate",
			Self::Sync => "Recreate",
		}
	}
}

/// A facility's per-server naming and identity: `server` is `facility-N` and
/// `device_id` is the facility id.
pub struct Ctx<'a> {
	pub cfg: &'a Config,
	pub server: &'a str,
	pub device_id: &'a str,
	pub pods: &'a PodFactory<'a>,
}

fn meta(cfg: &Config, name: String) -> ObjectMeta {
	ObjectMeta {
		name: Some(name),
		namespace: Some(cfg.namespace.clone()),
		..Default::default()
	}
}

fn deployment(
	ctx: &Ctx<'_>,
	name: String,
	component: &str,
	strategy: &str,
	replicas: u32,
	pod: PodSpec,
) -> Result<Value> {
	let cfg = ctx.cfg;
	let instance = Some(ctx.device_id);
	let mut labels = app_labels(cfg, ImageType::Facility, component, instance);
	labels.extend(cost_labels(cfg));

	let deployment = Deployment {
		metadata: meta(cfg, name),
		spec: Some(DeploymentSpec {
			replicas: Some(replicas as i32),
			strategy: Some(DeploymentStrategy {
				type_: Some(strategy.into()),
				rolling_update: None,
			}),
			selector: LabelSelector {
				match_labels: Some(app_selector(ImageType::Facility, component, instance)),
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
	Ok(waves::in_wave(
		serde_json::to_value(deployment)?,
		waves::WORKLOADS,
	))
}

fn http_get() -> HTTPGetAction {
	HTTPGetAction {
		path: Some("/".into()),
		port: IntOrString::Int(3000),
		..Default::default()
	}
}

/// The API or sync server: a Service and the Deployment behind it.
pub fn run_server(ctx: &Ctx<'_>, kind: ServerType, replicas: u32) -> Result<Vec<Value>> {
	let name = format!("{}-{}", ctx.server, kind.as_str());
	let component = format!("{}-server", kind.as_str());

	let service = Service {
		metadata: meta(ctx.cfg, name.clone()),
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
			selector: Some(app_selector(
				ImageType::Facility,
				&component,
				Some(ctx.device_id),
			)),
			..Default::default()
		}),
		..Default::default()
	};

	let pod = ctx.pods.build(PodArgs {
		pod_type: "server",
		command: vec![kind.command().into()],
		env: vec![env("PORT", "3000")],
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
				http_get: Some(http_get()),
				..Default::default()
			}),
			// ...then continuously check if it's up, and restart if it fails.
			liveness_probe: Some(Probe {
				period_seconds: Some(10),
				failure_threshold: Some(2),
				http_get: Some(http_get()),
				..Default::default()
			}),
			volume_mounts: vec![],
		},
	});

	Ok(vec![
		serde_json::to_value(service)?,
		deployment(ctx, name, &component, kind.strategy(), replicas, pod)?,
	])
}

/// The task runner. Stops the old pod before starting the new one, to avoid
/// doubling up on sync.
pub fn run_tasks(ctx: &Ctx<'_>) -> Result<Value> {
	let pod = ctx.pods.build(PodArgs {
		pod_type: "task-runner",
		command: vec!["startTasks".into()],
		..Default::default()
	});
	deployment(
		ctx,
		format!("{}-tasks", ctx.server),
		"task-runner",
		"Recreate",
		1,
		pod,
	)
}

/// A FHIR worker draining `topics`, or every topic if there are none.
///
/// `role` names the worker. Facility ids keep their case, which object names
/// cannot carry.
pub fn run_fhir_worker(ctx: &Ctx<'_>, role: &str, topics: &[&str]) -> Result<Value> {
	let component = format!("fhir-{role}");
	let mut command = vec!["startFhirWorker".to_owned()];
	if !topics.is_empty() {
		command.extend(["--topics".to_owned(), topics.join(",")]);
	}
	let pod = ctx.pods.build(PodArgs {
		pod_type: &component,
		command,
		..Default::default()
	});
	deployment(
		ctx,
		format!("facility-{role}-fhir-{}", ctx.device_id.to_lowercase()),
		&component,
		"Recreate",
		1,
		pod,
	)
}

/// Seeds the central host, credentials and facility into local system facts, so
/// the server is configured without the setup wizard. The sync user is the
/// provisioned admin. It needs the facts table, so it runs after the migrator,
/// and the servers wait on it by wave.
pub fn setup_sync(ctx: &Ctx<'_>) -> Result<Value> {
	let provisioning = ctx.cfg.provisioning.as_ref().ok_or_else(|| {
		anyhow!("setup-sync needs the provisioning document, which comes from the templates")
	})?;
	let sync_url = config_map::sync_url(ctx.cfg, provisioning)?;
	let mut pod = ctx.pods.build(PodArgs {
		pod_type: "setup-sync",
		command: vec!["setupSync".into()],
		env: vec![env("SYNC_URL", sync_url)],
		..Default::default()
	});
	pod.restart_policy = Some("Never".into());
	let job = Job {
		metadata: meta(ctx.cfg, format!("{}-setup-sync", ctx.server)),
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
	Ok(waves::hook(serde_json::to_value(job)?, waves::PROVISION))
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::params::Params;

	fn cfg() -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-abc",
			"cluster": { "fullName": "tamanu-internal-main" },
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	fn args(w: &Value) -> Vec<String> {
		serde_json::from_value(w["spec"]["template"]["spec"]["containers"][0]["args"].clone())
			.unwrap()
	}

	#[test]
	fn fhir_workers_take_their_topics_or_all_of_them() {
		let cfg = cfg();
		let pods = PodFactory::new(&cfg, "facility-1", None);
		let ctx = Ctx {
			cfg: &cfg,
			server: "facility-1",
			device_id: "Fac-1",
			pods: &pods,
		};
		let some = run_fhir_worker(&ctx, "resolver", &["a", "b"]).unwrap();
		assert_eq!(args(&some), ["startFhirWorker", "--topics", "a,b"]);
		assert_eq!(some["metadata"]["name"], "facility-resolver-fhir-fac-1");

		let all = run_fhir_worker(&ctx, "all", &[]).unwrap();
		assert_eq!(args(&all), ["startFhirWorker"]);
	}

	#[test]
	fn the_sync_server_restarts_by_recreation_and_the_api_by_rolling() {
		let cfg = cfg();
		let pods = PodFactory::new(&cfg, "facility-1", None);
		let ctx = Ctx {
			cfg: &cfg,
			server: "facility-1",
			device_id: "facility-1",
			pods: &pods,
		};
		let strategy = |kind| {
			let out = run_server(&ctx, kind, 2).unwrap();
			out[1]["spec"]["strategy"]["type"].clone()
		};
		assert_eq!(strategy(ServerType::Sync), "Recreate");
		assert_eq!(strategy(ServerType::Api), "RollingUpdate");
	}
}
