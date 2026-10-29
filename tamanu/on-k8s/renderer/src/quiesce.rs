//! Stops a server's processes while its migrator applies migrations, and starts
//! them again once it has. Each server gets a quiesce Job in the wave before its
//! migrator and a resume Job in the wave after; both run `quiesce.mjs` in the
//! server's own image, so no other image is pulled.

use std::collections::BTreeMap;

use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{
	Container, EnvVar, PodSpec, PodTemplateSpec, ResourceRequirements, ServiceAccount,
};
use k8s_openapi::api::rbac::v1::{PolicyRule, Role, RoleBinding, RoleRef, Subject};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use serde_json::Value;

use crate::config::Config;
use crate::pod::env;
use crate::{names, waves};

/// The first Tamanu release whose `just-migrate list --check` exits 0 when no
/// migrations are pending, 3 when some are, and anything else on
/// an error.
const PENDING_MIGRATIONS_VERSION: &str = "2.67.0-0";

// spec: K8STDR#quiescing-for-migrations
const REPLICAS_ANNOTATION: &str = "tamanu.bes.au/replicas-before-migration";

const SCRIPT: &str = include_str!("quiesce.mjs");
const SA_CA: &str = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/// Checks for pending migrations through the image's own entrypoint, as the
/// migrator runs `migrate`, then hands the answer to the script. Any exit but 0
/// or 3 is an error and fails the Job, so the sync stops before the migrator.
const QUIESCE_SHELL: &str = r#"set +e
/entrypoint just-migrate list --check
status=$?
set -e
case "$status" in
  0) PENDING=no ;;
  3) PENDING=yes ;;
  *) echo "just-migrate list --check failed with exit $status" >&2; exit "$status" ;;
esac
export PENDING
exec node --input-type=module -e "$QUIESCE_SCRIPT"
"#;

/// The pod type the server's pod factory builds the quiesce and resume pods
/// from; the command it is given is replaced.
pub const POD_TYPE: &str = "quiesce";

pub fn enabled(cfg: &Config) -> bool {
	cfg.at_least_version(PENDING_MIGRATIONS_VERSION)
}

/// The processes of `server`: its Deployments in `rendered`, but not its web
/// frontend, which does not touch the database.
fn processes(server: &str, rendered: &[Value]) -> Vec<String> {
	let web = format!("{server}-web");
	rendered
		.iter()
		.filter(|r| r["kind"] == "Deployment")
		.filter_map(|r| r["metadata"]["name"].as_str())
		.filter(|name| *name != web)
		.map(str::to_owned)
		.collect()
}

/// The quiesce and resume Jobs of `server`. `base` is the server's pod spec
/// built for [`POD_TYPE`]: the quiesce container keeps its database config and
/// resources to run `just-migrate list --check`, and both Jobs keep its
/// scheduling.
// spec: K8STDR#quiescing-for-migrations
pub fn jobs(
	cfg: &Config,
	server: &str,
	mut base: PodSpec,
	rendered: &[Value],
) -> serde_json::Result<Vec<Value>> {
	if !enabled(cfg) {
		return Ok(vec![]);
	}
	let deployments = processes(server, rendered).join(",");

	let server_container = base.containers.remove(0);
	let image = server_container.image.clone();
	base.service_account_name = Some(names::QUIESCE_SERVICE_ACCOUNT.into());
	base.restart_policy = Some("Never".into());

	let mut resume = base.clone();
	resume.volumes = None;
	resume.containers = vec![Container {
		command: Some(vec![
			"node".into(),
			"--input-type=module".into(),
			"-e".into(),
			SCRIPT.into(),
		]),
		env: Some(script_env("resume", &deployments)),
		resources: Some(small_resources()),
		..script_container(image.clone())
	}];

	let mut quiesce = base;
	let mut env = server_container.env.clone().unwrap_or_default();
	env.extend(script_env("quiesce", &deployments));
	env.push(EnvVar {
		name: "QUIESCE_SCRIPT".into(),
		value: Some(SCRIPT.into()),
		..Default::default()
	});
	quiesce.containers = vec![Container {
		command: Some(vec!["sh".into(), "-c".into(), QUIESCE_SHELL.into()]),
		env: Some(env),
		volume_mounts: server_container.volume_mounts,
		resources: server_container.resources,
		..script_container(image)
	}];

	Ok(vec![
		waves::hook(
			serde_json::to_value(job(cfg, format!("{server}-quiesce"), quiesce))?,
			waves::QUIESCE,
		),
		waves::hook(
			serde_json::to_value(job(cfg, format!("{server}-resume"), resume))?,
			waves::PROVISION,
		),
	])
}

/// The service account the quiesce and resume Jobs run as, with access to the
/// namespace's Deployments, their scale and its pods, and nothing else.
// spec: K8STDR#quiescing-for-migrations
pub fn access(cfg: &Config) -> serde_json::Result<Vec<Value>> {
	if !enabled(cfg) {
		return Ok(vec![]);
	}
	let name = names::QUIESCE_SERVICE_ACCOUNT;
	let meta = || ObjectMeta {
		name: Some(name.into()),
		namespace: Some(cfg.namespace.clone()),
		..Default::default()
	};
	let rule = |group: &str, resources: &[&str], verbs: &[&str]| PolicyRule {
		api_groups: Some(vec![group.into()]),
		resources: Some(resources.iter().map(|r| (*r).to_owned()).collect()),
		verbs: verbs.iter().map(|v| (*v).to_owned()).collect(),
		..Default::default()
	};

	let account = ServiceAccount {
		metadata: meta(),
		..Default::default()
	};
	let role = Role {
		metadata: meta(),
		rules: Some(vec![
			rule("apps", &["deployments"], &["get", "patch"]),
			rule("apps", &["deployments/scale"], &["patch"]),
			rule("", &["pods"], &["list"]),
		]),
	};
	let binding = RoleBinding {
		metadata: meta(),
		role_ref: RoleRef {
			api_group: Some("rbac.authorization.k8s.io".into()),
			kind: "Role".into(),
			name: name.into(),
		},
		subjects: Some(vec![Subject {
			kind: "ServiceAccount".into(),
			name: name.into(),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		}]),
	};

	[
		serde_json::to_value(account)?,
		serde_json::to_value(role)?,
		serde_json::to_value(binding)?,
	]
	.into_iter()
	.map(|r| Ok(waves::in_wave(r, waves::BASE)))
	.collect()
}

fn script_container(image: Option<String>) -> Container {
	Container {
		name: POD_TYPE.into(),
		image,
		image_pull_policy: Some("IfNotPresent".into()),
		..Default::default()
	}
}

fn script_env(mode: &str, deployments: &str) -> Vec<EnvVar> {
	vec![
		env("QUIESCE_MODE", mode),
		env("DEPLOYMENTS", deployments),
		env("ANNOTATION", REPLICAS_ANNOTATION),
		// The API server's certificate is signed by the cluster CA.
		env("NODE_EXTRA_CA_CERTS", SA_CA),
	]
}

fn small_resources() -> ResourceRequirements {
	ResourceRequirements {
		requests: Some(BTreeMap::from([
			("cpu".into(), Quantity("10m".into())),
			("memory".into(), Quantity("64Mi".into())),
		])),
		limits: Some(BTreeMap::from([(
			"memory".into(),
			Quantity("256Mi".into()),
		)])),
		..Default::default()
	}
}

fn job(cfg: &Config, name: String, pod: PodSpec) -> Job {
	Job {
		metadata: ObjectMeta {
			name: Some(name),
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
	}
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;

	#[test]
	fn processes_are_every_deployment_but_the_web_frontend() {
		let rendered = vec![
			json!({"kind": "Deployment", "metadata": {"name": "facility-1-api"}}),
			json!({"kind": "Deployment", "metadata": {"name": "facility-1-web"}}),
			json!({"kind": "Deployment", "metadata": {"name": "facility-refresh-fhir-facility-1"}}),
			json!({"kind": "Job", "metadata": {"name": "facility-1-migrator"}}),
		];
		assert_eq!(
			processes("facility-1", &rendered),
			["facility-1-api", "facility-refresh-fhir-facility-1"]
		);
	}
}
