//! Renders one Tamanu deployment to Kubernetes manifests.
//!
//! Input is a single JSON document (see [`params::Params`]), output is a
//! deterministic stream of manifests. Rendering is pure: it reads nothing from
//! the cluster, the clock or a random source, and it never emits secret values.

pub mod blob_store;
pub mod central;
pub mod config;
pub mod config_map;
pub mod crypto;
pub mod facility;
pub mod gateway;
pub mod meta;
pub mod migrator;
pub mod names;
pub mod params;
pub mod pod;
pub mod postgres;
pub mod redirect;
pub mod scheduling;
pub mod service_account;
pub mod synthetic;
pub mod wake;
pub mod waves;
pub mod web;

use std::path::PathBuf;

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;
use crate::params::Params;

/// What to do with a stack config key the renderer does not know.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum UnknownConfigKeys {
	/// Refuse to render, naming the keys. Finds a mistyped key.
	#[default]
	Reject,
	/// Render without them. Keeps a deployment rendering when the sender is ahead of the
	/// renderer.
	Ignore,
}

/// Inputs to rendering that are not part of the deployment's parameters.
#[derive(Debug, Clone, Default)]
pub struct Options {
	/// Read config templates from this directory instead of the ones built in.
	pub templates: Option<PathBuf>,
	/// What to do with a stack config key the renderer does not know.
	pub unknown_config_keys: UnknownConfigKeys,
}

impl Options {
	fn templates(&self) -> config_map::Templates {
		match &self.templates {
			Some(dir) => config_map::templates_at(dir),
			None => config_map::Templates::Embedded,
		}
	}
}

/// Everything a deployment consists of, sorted by kind, namespace and name.
/// Renders with the templates built into the binary; see [`render_with`].
pub fn render(params: &Params) -> Result<Vec<Value>> {
	render_with(params, &Options::default())
}

pub fn render_with(params: &Params, options: &Options) -> Result<Vec<Value>> {
	let unknown = params.config.unknown_keys();
	if !unknown.is_empty() && options.unknown_config_keys == UnknownConfigKeys::Reject {
		anyhow::bail!("unknown config key(s): {}", unknown.join(", "));
	}
	let mut cfg = Config::derive(params)?;
	let templates = options.templates();
	cfg.provisioning = Some(config_map::provisioning(&cfg, &templates)?.0);

	let mut out = Vec::new();
	out.extend(service_account::service_account(&cfg)?);
	out.extend(
		redirect::redirect_sites(&cfg)?
			.into_iter()
			.map(|r| waves::in_wave(r, waves::WORKLOADS)),
	);

	let mut portal = web::run_web(
		&cfg,
		web::WebArgs {
			name: "patient-portal",
			server_type: pod::ImageType::PatientPortal,
			image_type: pod::ImageType::PatientPortal,
			instance: None,
			replicas: cfg.patient_portal_replicas,
		},
	)?;
	out.extend(
		portal
			.drain(..)
			.map(|r| waves::in_wave(r, waves::WORKLOADS)),
	);
	out.extend(
		gateway::ingress(
			&cfg,
			"patient-portal",
			&cfg.domains.patient_portal,
			"central-api",
			"patient-portal-web",
		)?
		.into_iter()
		.map(|r| waves::in_wave(r, waves::WORKLOADS)),
	);

	out.extend(central::render(&cfg)?);
	out.extend(synthetic::synthetic_tests(&cfg)?);
	out.extend(wake::wake(&cfg)?);
	out.extend(facility::render(&cfg)?);

	out.extend(config_map::render(
		&cfg,
		&templates,
		&central::config_from_env(&cfg),
		&facility::config_from_env(&cfg),
	)?);

	out.sort_by_cached_key(sort_key);
	Ok(out)
}

fn sort_key(v: &Value) -> (String, String, String) {
	let s = |p: &str| {
		v.pointer(p)
			.and_then(Value::as_str)
			.unwrap_or("")
			.to_owned()
	};
	(s("/kind"), s("/metadata/namespace"), s("/metadata/name"))
}

/// Serialises manifests as a multi-document YAML stream.
pub fn to_yaml(resources: &[Value]) -> Result<String> {
	let mut out = String::new();
	for r in resources {
		out.push_str("---\n");
		out.push_str(&serde_norway::to_string(r)?);
	}
	Ok(out)
}

/// Serialises manifests as a stream of JSON documents separated by `---`.
///
/// This is what the Argo plugin emits. JSON is unambiguous: a YAML 1.1 parser,
/// which Argo CD uses, reads an unquoted `on` or `off` as a boolean, and
/// Postgres parameters contain both.
pub fn to_stream(resources: &[Value]) -> Result<String> {
	let mut out = String::new();
	for r in resources {
		out.push_str("---\n");
		out.push_str(&serde_json::to_string_pretty(r)?);
		out.push('\n');
	}
	Ok(out)
}
