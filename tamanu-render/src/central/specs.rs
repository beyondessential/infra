//! The central pod spec factory, ported from `central/specs.ts`.

use k8s_openapi::api::apps::v1::{Deployment, DeploymentSpec, DeploymentStrategy};
use k8s_openapi::api::core::v1::{
	ConfigMapVolumeSource, Container, EnvVar, PodSpec, PodTemplateSpec, ResourceRequirements,
	Volume, VolumeMount,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use serde_json::{Value, json};

use crate::blob_store::BlobStore;
use crate::config::Config;
use crate::meta::{Labels, app_labels, app_selector, cost_labels};
use crate::pod::{
	ContainerArgs, ImageType, app_memory_limit, env, env_secret, spot_toleration, workload_affinity,
};
use crate::{crypto, names, waves};

pub fn selector(component: &str) -> Labels {
	app_selector(ImageType::Central, component, None)
}

pub fn labels(cfg: &Config, component: &str) -> Labels {
	app_labels(cfg, ImageType::Central, component, None)
}

pub struct PodArgs {
	pub pod_type: String,
	pub command: Vec<String>,
	pub env: Vec<EnvVar>,
	pub volumes: Vec<Volume>,
	pub container: ContainerArgs,
}

impl PodArgs {
	pub fn new<const N: usize>(pod_type: &str, command: [&str; N]) -> Self {
		Self {
			pod_type: pod_type.into(),
			command: command.map(String::from).into(),
			env: vec![],
			volumes: vec![],
			container: ContainerArgs::default(),
		}
	}
}

pub struct PodSpecFactory<'a> {
	cfg: &'a Config,
	blob_store: Option<BlobStore>,
}

impl<'a> PodSpecFactory<'a> {
	pub fn new(cfg: &'a Config, blob_store: Option<BlobStore>) -> Self {
		Self { cfg, blob_store }
	}

	pub fn pod_spec(&self, args: PodArgs) -> PodSpec {
		let cfg = self.cfg;
		let PodArgs {
			pod_type,
			command,
			env: extra_env,
			volumes: extra_volumes,
			container,
		} = args;

		let mut volumes = vec![
			Volume {
				name: "config-volume".into(),
				config_map: Some(ConfigMapVolumeSource {
					name: names::app_config(super::SERVER),
					..Default::default()
				}),
				..Default::default()
			},
			crypto::volume(),
		];
		volumes.extend(self.blob_store.as_ref().map(|b| b.volume.clone()));
		volumes.extend(extra_volumes);

		let mut volume_mounts = vec![
			VolumeMount {
				name: "config-volume".into(),
				mount_path: "/config".into(),
				..Default::default()
			},
			crypto::volume_mount(),
		];
		volume_mounts.extend(self.blob_store.as_ref().map(|b| b.volume_mount.clone()));
		volume_mounts.extend(container.volume_mounts);

		let mut resources = ResourceRequirements {
			// Requests sit at the typical pod's p95; the limit only stops a leak
			// from pressuring the node (peaks seen are ~500Mi).
			requests: Some(
				[
					("cpu".to_owned(), Quantity("5m".into())),
					("memory".to_owned(), Quantity("256Mi".into())),
				]
				.into(),
			),
			..Default::default()
		};
		resources.limits = app_memory_limit(&pod_type);

		PodSpec {
			tolerations: Some(vec![spot_toleration()]),
			affinity: Some(workload_affinity(cfg)),
			service_account_name: cfg
				.service_account
				.is_some()
				.then(|| names::SERVICE_ACCOUNT.to_owned()),
			volumes: Some(volumes),
			containers: vec![Container {
				name: pod_type,
				image: Some(ImageType::Central.image(cfg)),
				image_pull_policy: Some("IfNotPresent".into()),
				args: Some(command),
				volume_mounts: Some(volume_mounts),
				env: Some(self.env(extra_env)),
				resources: Some(resources),
				ports: Some(container.ports).filter(|p| !p.is_empty()),
				startup_probe: container.startup_probe,
				liveness_probe: container.liveness_probe,
				..Default::default()
			}],
			..Default::default()
		}
	}

	fn env(&self, extra: Vec<EnvVar>) -> Vec<EnvVar> {
		let cfg = self.cfg;
		let server = super::SERVER;
		let secret_ref = env_secret;
		let auth = names::config_secrets(server);
		let app_db = names::db_app_secret(server);
		let raw = names::raw_db_secret(server);
		let reporting = names::reporting_db_secret(server);

		let mut out = extra;
		out.extend(crypto::envs());
		out.extend([
			env("TZ", &cfg.timezone),
			env("TAMANU_PRIMARY_TIMEZONE", &cfg.timezone),
			env("PROXY_TRUSTED", &cfg.proxy_trusted),
			env("DISK_PATH", "/"),
			env("NODE_ENV", &cfg.node_env),
		]);
		if let Some(sha) = cfg.image_tag.strip_prefix("sha-") {
			out.push(env("REVISION", sha.chars().take(10).collect::<String>()));
		}
		out.extend([
			// A single connection string for the core user. Tamanu prefers this
			// over the structured DB_* variables below, which stay as a fallback.
			secret_ref("DATABASE_URL", &app_db, names::DB_APP_URI_KEY),
			env("DB_HOST", names::db_rw_service(server)),
			secret_ref("DB_PASSWORD", &app_db, "password"),
			secret_ref("DB_USERNAME", &app_db, "username"),
			secret_ref("DB_NAME", &app_db, "username"),
			secret_ref("TUPAIA_API_USERNAME", "tupaia", "username"),
			secret_ref("TUPAIA_API_PASSWORD", "tupaia", "password"),
			secret_ref("MAILGUN_API_KEY", "mailgun", "apiKey"),
			secret_ref("MAILGUN_DOMAIN", "mailgun", "domain"),
			secret_ref("MAILGUN_FROM", "mailgun", "from"),
			secret_ref("BUGSNAG_API_KEY", "bugsnag", "apiKey"),
			secret_ref("DB_RAW_USERNAME", &raw, "username"),
			secret_ref("DB_RAW_PASSWORD", &raw, "password"),
			secret_ref("DB_REPORTING_USERNAME", &reporting, "username"),
			secret_ref("DB_REPORTING_PASSWORD", &reporting, "password"),
			secret_ref("AUTH_SECRET", &auth, names::AUTH_SECRET_KEY),
			secret_ref("AUTH_REFRESH_SECRET", &auth, names::AUTH_REFRESH_SECRET_KEY),
		]);
		out
	}
}

/// A central Deployment in the workloads wave. `component` labels and selects
/// its pods.
pub fn deployment(
	cfg: &Config,
	name: &str,
	component: &str,
	replicas: u32,
	recreate: bool,
	pod: PodSpec,
) -> serde_json::Result<Value> {
	let mut template_labels = labels(cfg, component);
	template_labels.extend(cost_labels(cfg));
	let deployment = Deployment {
		metadata: ObjectMeta {
			name: Some(name.into()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(DeploymentSpec {
			replicas: Some(replicas as i32),
			// Avoids double-running scheduled tasks.
			strategy: recreate.then(|| DeploymentStrategy {
				type_: Some("Recreate".into()),
				rolling_update: None,
			}),
			selector: LabelSelector {
				match_labels: Some(selector(component)),
				match_expressions: None,
			},
			template: PodTemplateSpec {
				metadata: Some(ObjectMeta {
					labels: Some(template_labels),
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

/// The `custom-environment-variables.json` the server reads: which config keys
/// come from which environment variables.
pub fn config_from_env() -> Value {
	json!({
		"auth": {
			"secret": "AUTH_SECRET",
			"refreshSecret": "AUTH_REFRESH_SECRET",
		},
		"db": {
			"host": "DB_HOST",
			"username": "DB_USERNAME",
			"password": "DB_PASSWORD",
			"name": "DB_NAME",
			"reportSchemas": {
				"connections": {
					"raw": {
						"username": "DB_RAW_USERNAME",
						"password": "DB_RAW_PASSWORD",
					},
					"reporting": {
						"username": "DB_REPORTING_USERNAME",
						"password": "DB_REPORTING_PASSWORD",
					},
				},
			},
		},
		// Kept for pre-2.61 builds; post-2.61 reads TZ directly. Remove with the
		// other legacy config keys once nothing older deploys from ops main.
		"countryTimeZone": "TZ",
		"localisation": { "timeZone": "TZ" },
		"tupaiaApiClient": {
			"auth": {
				"username": "TUPAIA_API_USERNAME",
				"password": "TUPAIA_API_PASSWORD",
			},
		},
		"mailgun": {
			"apiKey": "MAILGUN_API_KEY",
			"domain": "MAILGUN_DOMAIN",
			"from": "MAILGUN_FROM",
		},
		"errors": { "apiKey": "BUGSNAG_API_KEY" },
		"crypto": {
			"keyFile": "CRYPTO_KEY_FILE",
			"settingsPsk": "CRYPTO_SETTINGS_PSK",
		},
	})
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::central::test_support::cfg;

	fn pod(config: Value, pod_type: &str) -> Value {
		let cfg = cfg(config);
		let pods = PodSpecFactory::new(&cfg, None);
		serde_json::to_value(pods.pod_spec(PodArgs::new(pod_type, ["serve"]))).unwrap()
	}

	fn env_names(pod: &Value) -> Vec<&str> {
		pod["containers"][0]["env"]
			.as_array()
			.unwrap()
			.iter()
			.map(|e| e["name"].as_str().unwrap())
			.collect()
	}

	#[test]
	fn env_has_the_same_order_as_the_pulumi_program() {
		let pod = pod(json!({}), "server");
		assert_eq!(
			env_names(&pod),
			[
				"CRYPTO_KEY_FILE",
				"CRYPTO_SETTINGS_PSK",
				"TZ",
				"TAMANU_PRIMARY_TIMEZONE",
				"PROXY_TRUSTED",
				"DISK_PATH",
				"NODE_ENV",
				"REVISION",
				"DATABASE_URL",
				"DB_HOST",
				"DB_PASSWORD",
				"DB_USERNAME",
				"DB_NAME",
				"TUPAIA_API_USERNAME",
				"TUPAIA_API_PASSWORD",
				"MAILGUN_API_KEY",
				"MAILGUN_DOMAIN",
				"MAILGUN_FROM",
				"BUGSNAG_API_KEY",
				"DB_RAW_USERNAME",
				"DB_RAW_PASSWORD",
				"DB_REPORTING_USERNAME",
				"DB_REPORTING_PASSWORD",
				"AUTH_SECRET",
				"AUTH_REFRESH_SECRET",
			]
		);
		let env = pod["containers"][0]["env"].as_array().unwrap();
		assert_eq!(env[4]["value"], "loopback, 10.0.0.0/16, fd00::/48");
		assert_eq!(env[7]["value"], "a25d1d4035");
		assert_eq!(env[9]["value"], "central-db-rw");
	}

	#[test]
	fn revision_is_only_set_for_sha_tags() {
		let mut p = crate::central::test_support::cfg(json!({}));
		p.image_tag = "v2.67.0".into();
		let pods = PodSpecFactory::new(&p, None);
		let pod = serde_json::to_value(pods.pod_spec(PodArgs::new("server", ["serve"]))).unwrap();
		assert!(!env_names(&pod).contains(&"REVISION"));
	}

	#[test]
	fn extra_env_comes_first() {
		let cfg = cfg(json!({}));
		let pods = PodSpecFactory::new(&cfg, None);
		let mut args = PodArgs::new("server", ["serve"]);
		args.env = vec![env("PORT", "3000")];
		let pod = serde_json::to_value(pods.pod_spec(args)).unwrap();
		assert_eq!(env_names(&pod)[0], "PORT");
	}

	#[test]
	fn service_account_follows_config() {
		assert!(pod(json!({}), "server")["serviceAccountName"].is_null());
		let with = pod(
			json!({ "serviceAccount": "arn:aws:iam::111111111111:role/app" }),
			"server",
		);
		assert_eq!(with["serviceAccountName"], "app-sa");
	}

	#[test]
	fn one_shot_pods_have_no_memory_limit() {
		for ty in ["migrator", "provisioner"] {
			let pod = pod(json!({}), ty);
			assert!(
				pod["containers"][0]["resources"]["limits"].is_null(),
				"{ty}"
			);
		}
		let pod = pod(json!({}), "task-runner");
		assert_eq!(pod["containers"][0]["resources"]["limits"]["memory"], "1Gi");
	}

	#[test]
	fn config_and_crypto_are_always_mounted() {
		let pod = pod(json!({}), "server");
		let mounts: Vec<_> = pod["containers"][0]["volumeMounts"]
			.as_array()
			.unwrap()
			.iter()
			.map(|m| m["mountPath"].as_str().unwrap())
			.collect();
		assert_eq!(mounts, ["/config", "/secrets"]);
		assert_eq!(pod["volumes"][0]["configMap"]["name"], "config-central");
		assert_eq!(pod["volumes"][1]["secret"]["secretName"], "tamanu-crypto");
	}

	#[test]
	fn config_from_env_matches_what_the_pulumi_program_sent() {
		let sent = r#"{"db":{"host":"DB_HOST","username":"DB_USERNAME","password":"DB_PASSWORD","name":"DB_NAME","reportSchemas":{"connections":{"raw":{"username":"DB_RAW_USERNAME","password":"DB_RAW_PASSWORD"},"reporting":{"username":"DB_REPORTING_USERNAME","password":"DB_REPORTING_PASSWORD"}}}},"countryTimeZone":"TZ","localisation":{"timeZone":"TZ"},"tupaiaApiClient":{"auth":{"username":"TUPAIA_API_USERNAME","password":"TUPAIA_API_PASSWORD"}},"mailgun":{"apiKey":"MAILGUN_API_KEY","domain":"MAILGUN_DOMAIN","from":"MAILGUN_FROM"},"errors":{"apiKey":"BUGSNAG_API_KEY"},"crypto":{"keyFile":"CRYPTO_KEY_FILE","settingsPsk":"CRYPTO_SETTINGS_PSK"}}"#;
		let mut got = config_from_env();
		let auth = got.as_object_mut().unwrap().remove("auth").unwrap();
		assert_eq!(got, serde_json::from_str::<Value>(sent).unwrap());
		assert_eq!(auth["secret"], "AUTH_SECRET");
		assert_eq!(auth["refreshSecret"], "AUTH_REFRESH_SECRET");
	}
}
