use serde_json::{Value, json};
use tamanu_renderer::config::Config;
use tamanu_renderer::params::Params;

fn params(image_tag: &str, app_version: Option<&str>, config: Value) -> Params {
	serde_json::from_value(json!({
		"stack": "main",
		"imageTag": image_tag,
		"appVersion": app_version,
		"cluster": {
			"fullName": "tamanu-internal-main",
			"networkV4Cidr": "10.0.0.0/16",
			"networkV6Cidr": "2001:db8::/56",
		},
		"config": config,
	}))
	.unwrap()
}

fn render(p: &Params) -> Vec<Value> {
	let mut cfg = Config::derive(p).unwrap();
	cfg.provisioning = Some(json!({ "users": { "admin@tamanu.io": { "password": "fixture" } } }));
	tamanu_renderer::facility::render_apps(&cfg).unwrap()
}

fn yaml(resources: &[Value]) -> String {
	tamanu_renderer::to_yaml(resources).unwrap()
}

fn current(config: Value) -> Params {
	params(
		"sha-a25d1d40354fd2d38442bce75328310ca37abae9",
		Some("2.67.0"),
		config,
	)
}

fn names(resources: &[Value]) -> Vec<String> {
	resources
		.iter()
		.map(|r| {
			format!(
				"{} {}",
				r["kind"].as_str().unwrap(),
				r["metadata"]["name"].as_str().unwrap()
			)
		})
		.collect()
}

fn find<'a>(resources: &'a [Value], kind: &str, name: &str) -> &'a Value {
	resources
		.iter()
		.find(|r| r["kind"] == kind && r["metadata"]["name"] == name)
		.unwrap_or_else(|| panic!("no {kind} {name}"))
}

#[test]
fn one_current_facility() {
	let out = render(&current(json!({ "facilities": 1, "nodeEnv": "staging" })));
	insta::assert_snapshot!(yaml(&out));
}

#[test]
fn resource_names_for_two_facilities() {
	let out = render(&current(json!({ "facilities": 2 })));
	insta::assert_debug_snapshot!(names(&out));
}

#[test]
fn old_releases_skip_setup_sync_and_fhir() {
	let out = render(&params("v2.59.0", None, json!({ "facilities": 1 })));
	let names = names(&out);
	assert!(!names.iter().any(|n| n.contains("setup-sync")), "{names:?}");
	assert!(!names.iter().any(|n| n.contains("fhir")), "{names:?}");
	assert!(names.contains(&"Deployment facility-1-tasks".to_owned()));
	assert!(names.contains(&"Job facility-1-migrator".to_owned()));
}

#[test]
fn unknown_versions_read_as_old() {
	let out = render(&params("sha-abc", None, json!({ "facilities": 1 })));
	assert!(!names(&out).iter().any(|n| n.contains("setup-sync")));
}

#[test]
fn no_tasks_replicas_drops_tasks_and_fhir() {
	let out = render(&current(
		json!({ "facilities": 1, "facilityTasksReplicas": 0 }),
	));
	let names = names(&out);
	assert!(
		!names
			.iter()
			.any(|n| n.contains("tasks") || n.contains("fhir")),
		"{names:?}"
	);
	assert!(names.contains(&"Job facility-1-setup-sync".to_owned()));
}

#[test]
fn shared_blob_storage_mounts_a_claim_into_every_process() {
	let out = render(&current(
		json!({ "facilities": 1, "sharedBlobStorage": true }),
	));
	let claim = find(&out, "PersistentVolumeClaim", "facility-1-blobs");
	assert_eq!(claim["spec"]["storageClassName"], "efs");

	for (kind, name) in [
		("Deployment", "facility-1-api"),
		("Deployment", "facility-1-sync"),
		("Deployment", "facility-1-tasks"),
		("Job", "facility-1-migrator"),
		("Job", "facility-1-setup-sync"),
	] {
		let pod = &find(&out, kind, name)["spec"]["template"]["spec"];
		let mounts = pod["containers"][0]["volumeMounts"].as_array().unwrap();
		assert!(
			mounts
				.iter()
				.any(|m| m["mountPath"] == "/app/packages/facility-server/data/blobs"),
			"{kind} {name}"
		);
	}
}

#[test]
fn without_shared_blob_storage_there_is_no_claim() {
	let out = render(&current(json!({ "facilities": 1 })));
	assert!(
		!names(&out)
			.iter()
			.any(|n| n.starts_with("PersistentVolumeClaim"))
	);
}

#[test]
fn facility_ids_keep_their_case_but_object_names_do_not() {
	let out = render(&current(json!({
		"facilities": 1,
		"facilityNames": [{ "id": "Kule", "host": "Kule-Host" }],
	})));
	let fhir = find(&out, "Deployment", "facility-refresh-fhir-kule");
	let labels = &fhir["spec"]["selector"]["matchLabels"];
	assert_eq!(labels["app.kubernetes.io/instance"], "Kule");

	let web = find(&out, "Deployment", "facility-1-web");
	assert_eq!(
		web["spec"]["selector"]["matchLabels"]["app.kubernetes.io/instance"],
		"Kule"
	);

	let gateway = find(&out, "Gateway", "facility-1");
	assert_eq!(
		gateway["spec"]["listeners"][0]["hostname"],
		"kule-host.main.cd.tamanu.app"
	);
}

#[test]
fn processes_are_ordered_by_wave() {
	let out = render(&current(json!({ "facilities": 1 })));
	let wave = |kind: &str, name: &str| {
		find(&out, kind, name)["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"]
			.as_str()
			.unwrap()
			.to_owned()
	};
	assert_eq!(wave("Job", "facility-1-migrator"), "2");
	assert_eq!(wave("Job", "facility-1-setup-sync"), "3");
	assert_eq!(wave("Deployment", "facility-1-api"), "4");
	assert_eq!(wave("HTTPRoute", "facility-1-api"), "4");
	let hook = &find(&out, "Job", "facility-1-setup-sync")["metadata"]["annotations"];
	assert_eq!(hook["argocd.argoproj.io/hook"], "Sync");
}

#[test]
fn no_secrets_are_rendered_and_credentials_are_referenced() {
	let out = render(&current(json!({ "facilities": 2 })));
	assert!(!out.iter().any(|r| r["kind"] == "Secret"));

	// The provisioned admin's credentials already sit in the provisioning
	// ConfigMap, so the setup-sync Job carries them in its URL.
	let job = find(&out, "Job", "facility-2-setup-sync");
	let env = job["spec"]["template"]["spec"]["containers"][0]["env"]
		.as_array()
		.unwrap();
	let sync_url = env.iter().find(|e| e["name"] == "SYNC_URL").unwrap();
	assert_eq!(
		sync_url["value"],
		"https://admin%40tamanu.io:fixture@central.main.cd.tamanu.app/"
	);
}

#[test]
fn only_long_running_processes_have_a_memory_limit() {
	let out = render(&current(json!({ "facilities": 1 })));
	let limit = |kind: &str, name: &str| {
		find(&out, kind, name)["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"]
			.clone()
	};
	assert_eq!(
		limit("Deployment", "facility-1-api"),
		json!({ "memory": "1Gi" })
	);
	assert_eq!(limit("Job", "facility-1-migrator"), Value::Null);
	assert_eq!(limit("Job", "facility-1-setup-sync"), Value::Null);
}

#[test]
fn rendering_is_deterministic() {
	let p = current(json!({ "facilities": 3 }));
	assert_eq!(yaml(&render(&p)), yaml(&render(&p)));
}

#[test]
fn each_facility_has_a_cluster_and_grants_beside_its_apps() {
	let p = current(json!({ "facilities": 2 }));
	let mut cfg = Config::derive(&p).unwrap();
	cfg.provisioning = Some(json!({ "users": { "admin@tamanu.io": { "password": "fixture" } } }));
	let out = tamanu_renderer::facility::render(&cfg).unwrap();
	let names = names(&out);
	for n in [1, 2] {
		assert!(
			names.contains(&format!("Cluster facility-{n}-db")),
			"{names:?}"
		);
		assert!(
			names.contains(&format!("Job facility-{n}-reporting-grants")),
			"{names:?}"
		);
		assert!(
			names.contains(&format!("Deployment facility-{n}-api")),
			"{names:?}"
		);
	}
	assert!(!out.iter().any(|r| r["kind"] == "Secret"));
}
