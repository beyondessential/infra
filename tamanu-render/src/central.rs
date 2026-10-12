//! Central server: API, tasks, FHIR workers, migrator, provisioner, reporting
//! grants and its web frontend and ingress. Ported from `central/` in the
//! `tamanu-on-k8s` Pulumi project.

use anyhow::Result;
use serde_json::Value;

use crate::config::Config;

pub fn render(_cfg: &Config) -> Result<Vec<Value>> {
	Ok(vec![])
}
