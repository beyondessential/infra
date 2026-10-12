//! Labels, selectors and cost labels shared by every workload.

use std::collections::BTreeMap;

use crate::config::Config;
use crate::pod::ImageType;

pub type Labels = BTreeMap<String, String>;

pub fn app_selector(server_type: ImageType, component: &str, instance: Option<&str>) -> Labels {
	let mut m = Labels::new();
	m.insert("app.kubernetes.io/name".into(), server_type.as_str().into());
	m.insert("app.kubernetes.io/component".into(), component.into());
	if let Some(i) = instance {
		m.insert("app.kubernetes.io/instance".into(), i.into());
	}
	m
}

pub fn app_labels(
	cfg: &Config,
	server_type: ImageType,
	component: &str,
	instance: Option<&str>,
) -> Labels {
	let mut m = app_selector(server_type, component, instance);
	m.insert("app.kubernetes.io/version".into(), cfg.image_tag.clone());
	m
}

/// Labels the cost allocation reads, from `billingTags` in the program.
pub fn cost_labels(cfg: &Config) -> Labels {
	let mut m = Labels::new();
	for (key, value) in [
		("product", Some("tamanu")),
		("stage", Some(cfg.billing_stage.as_str())),
		("deployment", Some(cfg.billing_deployment.as_str())),
	] {
		if let Some(v) = value.filter(|v| !v.is_empty()) {
			m.insert(format!("billing.{key}"), v.into());
		}
	}
	m
}
