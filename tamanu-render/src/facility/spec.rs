//! The facility pod spec factory, ported from `facility/specs.ts` and
//! `common/specFactory.ts`.

use k8s_openapi::api::core::v1::{
	ConfigMapVolumeSource, Container, EnvVar, PodSpec, ResourceRequirements, Volume, VolumeMount,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use std::collections::BTreeMap;

use crate::blob_store::BlobStore;
use crate::config::Config;
use crate::crypto;
use crate::names;
use crate::pod::{
	ContainerArgs, ImageType, app_memory_limit, env, env_secret, spot_toleration, workload_affinity,
};

/// Builds the pod spec for each process of one facility. The processes differ
/// only in their container name, command, extra env and container settings.
pub struct PodFactory<'a> {
	cfg: &'a Config,
	server: &'a str,
	blob_store: Option<&'a BlobStore>,
}

#[derive(Default)]
pub struct PodArgs<'a> {
	pub pod_type: &'a str,
	pub command: Vec<String>,
	pub env: Vec<EnvVar>,
	pub container: ContainerArgs,
}

impl<'a> PodFactory<'a> {
	/// `server` is `facility-N`.
	pub fn new(cfg: &'a Config, server: &'a str, blob_store: Option<&'a BlobStore>) -> Self {
		Self {
			cfg,
			server,
			blob_store,
		}
	}

	pub fn build(&self, args: PodArgs<'_>) -> PodSpec {
		let PodArgs {
			pod_type,
			command,
			env: extra_env,
			container,
		} = args;
		let cfg = self.cfg;

		let mut volumes = vec![
			Volume {
				name: "config-volume".into(),
				config_map: Some(ConfigMapVolumeSource {
					name: names::app_config(self.server),
					..Default::default()
				}),
				..Default::default()
			},
			crypto::volume(),
		];
		volumes.extend(self.blob_store.map(|b| b.volume.clone()));

		let mut mounts = vec![
			VolumeMount {
				name: "config-volume".into(),
				mount_path: "/config".into(),
				..Default::default()
			},
			crypto::volume_mount(),
		];
		mounts.extend(self.blob_store.map(|b| b.volume_mount.clone()));
		mounts.extend(container.volume_mounts);

		let mut env = extra_env;
		env.extend(self.base_env());

		// Requests sit at the typical pod's p95; the limit only stops a leak from
		// pressuring the node (peaks seen are ~650Mi).
		let quantity = |s: &str| Quantity(s.into());
		let resources = ResourceRequirements {
			requests: Some(BTreeMap::from([
				("cpu".into(), quantity("5m")),
				("memory".into(), quantity("200Mi")),
			])),
			limits: app_memory_limit(pod_type),
			..Default::default()
		};

		PodSpec {
			tolerations: Some(vec![spot_toleration()]),
			affinity: Some(workload_affinity(cfg)),
			volumes: Some(volumes),
			containers: vec![Container {
				name: pod_type.into(),
				image: Some(ImageType::Facility.image(cfg)),
				image_pull_policy: Some("IfNotPresent".into()),
				args: Some(command).filter(|c| !c.is_empty()),
				volume_mounts: Some(mounts),
				env: Some(env),
				resources: Some(resources),
				ports: Some(container.ports).filter(|p| !p.is_empty()),
				startup_probe: container.startup_probe,
				liveness_probe: container.liveness_probe,
				..Default::default()
			}],
			..Default::default()
		}
	}

	fn base_env(&self) -> Vec<EnvVar> {
		let cfg = self.cfg;
		let server = self.server;
		let app_db = names::db_app_secret(server);
		let raw = names::raw_db_secret(server);
		let reporting = names::reporting_db_secret(server);

		let mut env = crypto::envs();
		env.extend([
			self::env("TZ", &cfg.timezone),
			self::env("TAMANU_PRIMARY_TIMEZONE", &cfg.timezone),
			self::env("PROXY_TRUSTED", &cfg.proxy_trusted),
			self::env("NODE_ENV", &cfg.node_env),
		]);
		if let Some(sha) = cfg.image_tag.strip_prefix("sha-") {
			env.push(self::env(
				"REVISION",
				sha.chars().take(10).collect::<String>(),
			));
		}
		env.extend([
			// Single connection string for the core user. Tamanu prefers this over
			// the structured DB_* vars below, which stay as a fallback.
			env_secret(
				"DATABASE_URL",
				&names::db_url_secret(server),
				names::DB_URL_KEY,
			),
			self::env("DB_HOST", names::db_rw_service(server)),
			env_secret("DB_PASSWORD", &app_db, "password"),
			env_secret("DB_USERNAME", &app_db, "username"),
			env_secret("DB_NAME", &app_db, "username"),
			env_secret("BUGSNAG_API_KEY", "bugsnag", "apiKey"),
			env_secret("DB_RAW_USERNAME", &raw, "username"),
			env_secret("DB_RAW_PASSWORD", &raw, "password"),
			env_secret("DB_REPORTING_USERNAME", &reporting, "username"),
			env_secret("DB_REPORTING_PASSWORD", &reporting, "password"),
		]);
		env
	}
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::blob_store::{BlobServer, blob_store_volume};
	use crate::params::Params;

	fn cfg(image_tag: &str) -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": image_tag,
			"cluster": {
				"fullName": "tamanu-internal-main",
				"networkV4Cidr": "10.0.0.0/16",
			},
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	fn names(vars: &[EnvVar]) -> Vec<&str> {
		vars.iter().map(|e| e.name.as_str()).collect()
	}

	#[test]
	fn caller_env_comes_first_and_revision_needs_a_sha_tag() {
		let cfg = cfg("v2.60.0");
		let pods = PodFactory::new(&cfg, "facility-1", None);
		let pod = pods.build(PodArgs {
			pod_type: "server",
			env: vec![env("PORT", "3000")],
			..Default::default()
		});
		let vars = pod.containers[0].env.clone().unwrap();
		let names = names(&vars);
		assert_eq!(names[0], "PORT");
		assert_eq!(names[1], "CRYPTO_KEY_FILE");
		assert!(!names.contains(&"REVISION"));
		let trusted = vars.iter().find(|e| e.name == "PROXY_TRUSTED").unwrap();
		assert_eq!(trusted.value.as_deref(), Some("loopback, 10.0.0.0/16"));
	}

	#[test]
	fn revision_is_the_first_ten_characters_of_the_sha() {
		let cfg = cfg("sha-0123456789abcdef");
		let pod = PodFactory::new(&cfg, "facility-1", None).build(PodArgs {
			pod_type: "server",
			..Default::default()
		});
		let vars = pod.containers[0].env.clone().unwrap();
		let revision = vars.iter().find(|e| e.name == "REVISION").unwrap();
		assert_eq!(revision.value.as_deref(), Some("0123456789"));
	}

	#[test]
	fn the_blob_store_goes_between_the_crypto_mount_and_the_callers() {
		let cfg = cfg("sha-abc");
		let store = blob_store_volume(&cfg, "facility-1", BlobServer::Facility).unwrap();
		let pod = PodFactory::new(&cfg, "facility-1", Some(&store)).build(PodArgs {
			pod_type: "server",
			container: ContainerArgs {
				volume_mounts: vec![VolumeMount {
					name: "extra".into(),
					mount_path: "/extra".into(),
					..Default::default()
				}],
				..Default::default()
			},
			..Default::default()
		});
		let mounts = pod.containers[0].volume_mounts.clone().unwrap();
		let got: Vec<_> = mounts.iter().map(|m| m.name.as_str()).collect();
		assert_eq!(got, ["config-volume", "crypto-key", "blob-store", "extra"]);
		let volumes = pod.volumes.unwrap();
		let got: Vec<_> = volumes.iter().map(|v| v.name.as_str()).collect();
		assert_eq!(got, ["config-volume", "crypto-key", "blob-store"]);
	}
}
