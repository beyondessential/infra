//! Facility servers: API, tasks, FHIR, setup-sync, web frontend and ingress for
//! each facility. Ported from `facility/` in the `tamanu-on-k8s` Pulumi project.

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;

pub fn render(_cfg: &Config) -> Result<Vec<Value>> {
	Ok(vec![])
}
