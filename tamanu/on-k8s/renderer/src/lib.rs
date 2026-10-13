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
pub mod waves;
pub mod web;

use std::path::PathBuf;

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;
use crate::params::Params;

/// Inputs to rendering that are not part of the deployment's parameters.
#[derive(Debug, Clone, Default)]
pub struct Options {
	/// Where the config templates are. Without them the ConfigMaps are not
	/// rendered, and the facilities' setup-sync Jobs cannot be.
	pub templates: Option<PathBuf>,
}

/// Everything a deployment consists of, sorted by kind, namespace and name.
/// Renders without config templates; see [`render_with`].
pub fn render(params: &Params) -> Result<Vec<Value>> {
	render_with(params, &Options::default())
}

pub fn render_with(params: &Params, options: &Options) -> Result<Vec<Value>> {
	let mut cfg = Config::derive(params)?;
	let templates = options.templates.as_deref().map(config_map::templates_at);
	if let Some(templates) = &templates {
		cfg.provisioning = Some(config_map::provisioning(&cfg, templates)?.0);
	}

	let mut out = Vec::new();
	out.extend(service_account::service_account(&cfg)?);
	out.extend(redirect::redirect_sites(&cfg)?);

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
	out.append(&mut portal);
	out.extend(gateway::ingress(
		&cfg,
		"patient-portal",
		&cfg.domains.patient_portal,
		"central-api",
		"patient-portal-web",
	)?);

	out.extend(central::render(&cfg)?);
	out.extend(facility::render(&cfg)?);

	if let Some(templates) = &templates {
		out.extend(config_map::render(
			&cfg,
			templates,
			&central::config_from_env(),
			&facility::config_from_env(),
		)?);
	}

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
