//! Renders one Tamanu deployment to Kubernetes manifests.
//!
//! Input is a single JSON document (see [`params::Params`]), output is a
//! deterministic stream of manifests. Rendering is pure: it reads nothing from
//! the cluster, the clock or a random source, and it never emits secret values.

pub mod central;
pub mod config;
pub mod facility;
pub mod gateway;
pub mod meta;
pub mod migrator;
pub mod names;
pub mod params;
pub mod pod;
pub mod postgres;
pub mod redirect;
pub mod waves;
pub mod web;

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;
use crate::params::Params;

/// Everything a deployment consists of, sorted by kind, namespace and name.
pub fn render(params: &Params) -> Result<Vec<Value>> {
	let cfg = Config::derive(params)?;
	let mut out = Vec::new();

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
