//! Central server: API, tasks, FHIR workers, migrator, provisioner, reporting
//! grants and its web frontend and ingress. Ported from `central/` in the
//! `tamanu-on-k8s` Pulumi project.

mod api;
pub mod database;
mod fhir;
mod provisioner;
mod seed_top_up;
mod specs;
mod tasks;

use anyhow::Result;
use k8s_openapi::api::core::v1::{Service, ServicePort, ServiceSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::Value;

use crate::blob_store::{BlobServer, blob_store_volume};
use crate::config::Config;
use crate::pod::ImageType;
use crate::web::{WebArgs, run_web};
use crate::{gateway, migrator, names, waves};

pub use specs::config_from_env;

/// Names the server in resource names and the database cluster.
pub const SERVER: &str = "central";

pub fn render(cfg: &Config) -> Result<Vec<Value>> {
	let mut out = workloads(cfg)?;
	out.extend(database::render(cfg)?);
	Ok(out)
}

/// Everything but the database cluster and its roles and grants.
pub fn workloads(cfg: &Config) -> Result<Vec<Value>> {
	let mut out = Vec::new();

	let blob_store = if cfg.shared_blob_storage {
		let store = blob_store_volume(cfg, SERVER, BlobServer::Central)?;
		out.push(store.claim.clone());
		Some(store)
	} else {
		None
	};
	let pods = specs::PodSpecFactory::new(cfg, blob_store);

	out.push(migrator::migrator(
		cfg,
		SERVER,
		pods.pod_spec(specs::PodArgs::new("migrator", ["migrate"])),
	)?);
	out.push(provisioner::provisioner(cfg, &pods)?);
	out.extend(seed_top_up::seed_top_up(cfg, &pods)?);
	out.push(tasks::tasks(cfg, &pods)?);
	out.extend(fhir::fhir_workers(cfg, &pods)?);
	out.extend(api::api(cfg, &pods)?);

	let web = run_web(
		cfg,
		WebArgs {
			name: SERVER,
			server_type: ImageType::Central,
			image_type: ImageType::Frontend,
			instance: None,
			replicas: cfg.replicas.central.web,
		},
	)?;
	out.extend(web.into_iter().map(|r| waves::in_wave(r, waves::WORKLOADS)));
	out.extend(
		gateway::ingress(
			cfg,
			SERVER,
			&cfg.domains.central,
			&api::service_name(),
			&format!("{SERVER}-web"),
		)?
		.into_iter()
		.map(|r| waves::in_wave(r, waves::WORKLOADS)),
	);

	if cfg.db.expose {
		out.push(waves::in_wave(
			serde_json::to_value(db_tailscale_service(cfg))?,
			waves::WORKLOADS,
		));
	}

	Ok(out)
}

/// Exposes the central database primary on the tailnet.
fn db_tailscale_service(cfg: &Config) -> Service {
	Service {
		metadata: ObjectMeta {
			name: Some("central-db-tailscale".into()),
			namespace: Some(cfg.namespace.clone()),
			annotations: Some(
				[
					// k8s-pg and tamanu are the same length, so the name needs no
					// further truncation.
					(
						"tailscale.com/hostname".to_owned(),
						format!("k8s-pg-{}", cfg.stack),
					),
					("tailscale.com/tags".to_owned(), cfg.db.expose_tags.clone()),
				]
				.into(),
			),
			..Default::default()
		},
		spec: Some(ServiceSpec {
			type_: Some("LoadBalancer".into()),
			load_balancer_class: Some("tailscale".into()),
			selector: Some(
				[
					("cnpg.io/cluster".to_owned(), names::db_cluster(SERVER)),
					("cnpg.io/instanceRole".to_owned(), "primary".to_owned()),
				]
				.into(),
			),
			allocate_load_balancer_node_ports: Some(false),
			ports: Some(vec![ServicePort {
				protocol: Some("TCP".into()),
				port: 5432,
				target_port: Some(IntOrString::Int(5432)),
				name: Some("postgresql".into()),
				..Default::default()
			}]),
			..Default::default()
		}),
		..Default::default()
	}
}

#[cfg(test)]
pub(crate) mod test_support {
	use serde_json::{Value, json};

	use crate::config::Config;
	use crate::params::Params;

	pub fn cfg_with(cluster: Value, config: Value) -> Config {
		let mut cl = json!({
			"fullName": "example-main",
			"networkV4Cidr": "10.0.0.0/16",
			"networkV6Cidr": "fd00::/48",
			"tailscaleProxyDefaultTags": ["tag:k8s", "tag:k8s-proxy"],
		});
		cl.as_object_mut()
			.unwrap()
			.extend(cluster.as_object().unwrap().clone());
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
			"appVersion": "2.67.0",
			"cluster": cl,
			"config": config,
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	pub fn cfg(config: Value) -> Config {
		cfg_with(json!({}), config)
	}
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::test_support::{cfg, cfg_with};
	use super::*;

	fn find<'a>(out: &'a [Value], kind: &str, name: &str) -> &'a Value {
		out.iter()
			.find(|v| v["kind"] == kind && v["metadata"]["name"] == name)
			.unwrap_or_else(|| panic!("no {kind} {name}"))
	}

	#[test]
	fn renders_the_central_workloads() {
		let out = workloads(&cfg(json!({}))).unwrap();
		let mut got: Vec<_> = out
			.iter()
			.map(|v| {
				format!(
					"{} {}",
					v["kind"].as_str().unwrap(),
					v["metadata"]["name"].as_str().unwrap()
				)
			})
			.collect();
		got.sort();
		assert_eq!(
			got,
			[
				"ClientTrafficPolicy central-traffic-policy",
				"Deployment central-api",
				"Deployment central-fhir-refresh",
				"Deployment central-fhir-resolver",
				"Deployment central-tasks",
				"Deployment central-web",
				"Gateway central",
				"HTTPRoute central-api",
				"HTTPRoute central-api-import",
				"HTTPRoute central-api-import-legacy",
				"HTTPRoute central-api-legacy",
				"HTTPRoute central-frontend",
				"Job central-migrator",
				"Job central-provisioner",
				"PodDisruptionBudget central-api",
				"PodDisruptionBudget central-web",
				"Service central-api",
				"Service central-db-tailscale",
				"Service central-web",
			]
		);
	}

	#[test]
	fn jobs_are_hooks_and_workloads_wait_for_them() {
		let out = workloads(&cfg(json!({}))).unwrap();
		let wave = |kind, name| {
			let a = &find(&out, kind, name)["metadata"]["annotations"];
			(
				a["argocd.argoproj.io/sync-wave"]
					.as_str()
					.unwrap()
					.to_owned(),
				a.get("argocd.argoproj.io/hook").is_some(),
			)
		};
		assert_eq!(wave("Job", "central-migrator"), ("1".into(), true));
		assert_eq!(wave("Job", "central-provisioner"), ("2".into(), true));
		assert_eq!(wave("Deployment", "central-api"), ("3".into(), false));
		assert_eq!(wave("Deployment", "central-web"), ("3".into(), false));
		assert_eq!(wave("HTTPRoute", "central-api"), ("3".into(), false));
	}

	#[test]
	fn tasks_scale_to_zero_and_fhir_workers_follow_the_replica_config() {
		let out = workloads(&cfg(json!({ "centralTasksReplicas": 0 }))).unwrap();
		for name in [
			"central-tasks",
			"central-fhir-refresh",
			"central-fhir-resolver",
		] {
			assert_eq!(
				find(&out, "Deployment", name)["spec"]["replicas"],
				0,
				"{name}"
			);
		}
		assert_eq!(
			find(&out, "Deployment", "central-tasks")["spec"]["strategy"]["type"],
			"Recreate"
		);
	}

	#[test]
	fn the_tailscale_service_can_be_switched_off() {
		let out = workloads(&cfg(json!({ "dbExpose": false }))).unwrap();
		assert!(
			out.iter()
				.all(|v| v["metadata"]["name"] != "central-db-tailscale")
		);
	}

	#[test]
	fn the_tailscale_service_is_tagged_for_the_cluster() {
		let demo = cfg_with(json!({ "fullName": "example-demo" }), json!({}));
		let svc = serde_json::to_value(db_tailscale_service(&demo)).unwrap();
		assert_eq!(
			svc["metadata"]["annotations"]["tailscale.com/tags"],
			"tag:k8s,tag:k8s-proxy,tag:server,tag:server-tamanu,tag:server-tamanu-demo"
		);
		assert_eq!(
			svc["metadata"]["annotations"]["tailscale.com/hostname"],
			"k8s-pg-main"
		);
	}

	#[test]
	fn the_ingress_targets_the_central_services() {
		let out = workloads(&cfg(json!({}))).unwrap();
		let route = find(&out, "HTTPRoute", "central-api");
		assert_eq!(
			route["spec"]["rules"][0]["backendRefs"][0]["name"],
			"central-api"
		);
		let route = find(&out, "HTTPRoute", "central-frontend");
		assert_eq!(
			route["spec"]["rules"][0]["backendRefs"][0]["name"],
			"central-web"
		);
		let gateway = find(&out, "Gateway", "central");
		assert_eq!(
			gateway["spec"]["listeners"][0]["hostname"],
			"central.main.cd.tamanu.app"
		);
	}

	#[test]
	fn shared_blob_storage_adds_a_claim_and_mounts_it_everywhere() {
		let out = workloads(&cfg(json!({ "sharedBlobStorage": true }))).unwrap();
		let claim = find(&out, "PersistentVolumeClaim", "central-blobs");
		assert_eq!(claim["spec"]["storageClassName"], "efs");
		assert_eq!(claim["spec"]["accessModes"][0], "ReadWriteMany");
		for (kind, name) in [
			("Job", "central-migrator"),
			("Job", "central-provisioner"),
			("Deployment", "central-api"),
			("Deployment", "central-tasks"),
		] {
			let pod = &find(&out, kind, name)["spec"]["template"]["spec"];
			let mounts = pod["containers"][0]["volumeMounts"].as_array().unwrap();
			assert!(
				mounts.iter().any(|m| m["name"] == "blob-store"
					&& m["mountPath"] == "/app/packages/central-server/data/blobs"),
				"{name}"
			);
			assert!(
				pod["volumes"]
					.as_array()
					.unwrap()
					.iter()
					.any(|v| { v["persistentVolumeClaim"]["claimName"] == "central-blobs" })
			);
		}
	}

	#[test]
	fn no_blob_claim_by_default() {
		let out = workloads(&cfg(json!({}))).unwrap();
		assert!(out.iter().all(|v| v["kind"] != "PersistentVolumeClaim"));
	}
}
