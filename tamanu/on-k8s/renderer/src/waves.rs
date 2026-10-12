//! Argo CD sync ordering.
//!
//! Waves order resources within one sync, and a wave starts only when the
//! previous one is healthy. Jobs that must run on every deploy are `Sync`
//! hooks deleted before they are created again, which sidesteps Job
//! immutability. They rerun on every sync, including infrastructure-only ones.

use serde_json::{Value, json};

/// Config, service accounts and the database cluster.
pub const BASE: i32 = 0;
/// Reporting grants and the migrator, which need a healthy database.
pub const MIGRATE: i32 = 1;
/// The provisioner, which needs a migrated schema.
pub const PROVISION: i32 = 2;
/// Workloads and routes.
pub const WORKLOADS: i32 = 3;

fn annotate(resource: &mut Value, key: &str, value: &str) {
	let meta = resource
		.as_object_mut()
		.expect("a manifest is an object")
		.entry("metadata")
		.or_insert_with(|| json!({}));
	let annotations = meta
		.as_object_mut()
		.expect("metadata is an object")
		.entry("annotations")
		.or_insert_with(|| json!({}));
	annotations
		.as_object_mut()
		.expect("annotations is an object")
		.insert(key.to_owned(), Value::String(value.to_owned()));
}

pub fn in_wave(mut resource: Value, wave: i32) -> Value {
	annotate(
		&mut resource,
		"argocd.argoproj.io/sync-wave",
		&wave.to_string(),
	);
	resource
}

/// A resource that runs as part of the sync, in `wave`, and is deleted before
/// the next run creates it again.
pub fn hook(resource: Value, wave: i32) -> Value {
	let mut resource = in_wave(resource, wave);
	annotate(&mut resource, "argocd.argoproj.io/hook", "Sync");
	annotate(
		&mut resource,
		"argocd.argoproj.io/hook-delete-policy",
		"BeforeHookCreation",
	);
	resource
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hooks_are_waved_and_deleted_before_recreation() {
		let job = hook(json!({"kind": "Job", "metadata": {"name": "x"}}), MIGRATE);
		let a = &job["metadata"]["annotations"];
		assert_eq!(a["argocd.argoproj.io/sync-wave"], "1");
		assert_eq!(a["argocd.argoproj.io/hook"], "Sync");
		assert_eq!(
			a["argocd.argoproj.io/hook-delete-policy"],
			"BeforeHookCreation"
		);
	}
}
