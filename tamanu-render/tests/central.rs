use serde_json::{Value, json};
use tamanu_render::config::Config;
use tamanu_render::params::Params;

fn config(extra_config: Value) -> Config {
	let p: Params = serde_json::from_value(json!({
		"stack": "main",
		"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
		"appVersion": "2.67.0",
		"cluster": {
			"fullName": "example-main",
			"networkV4Cidr": "10.0.0.0/16",
			"networkV6Cidr": "fd00::/48",
			"tailscaleProxyDefaultTags": ["tag:k8s", "tag:k8s-proxy"],
		},
		"config": extra_config,
	}))
	.unwrap();
	Config::derive(&p).unwrap()
}

fn yaml(cfg: &Config) -> String {
	let mut out = tamanu_render::central::workloads(cfg).unwrap();
	out.sort_by_key(|v| {
		(
			v["kind"].as_str().unwrap().to_owned(),
			v["metadata"]["name"].as_str().unwrap().to_owned(),
		)
	});
	tamanu_render::to_yaml(&out).unwrap()
}

#[test]
fn central_workloads() {
	insta::assert_snapshot!(yaml(&config(json!({ "nodeEnv": "staging" }))));
}

#[test]
fn central_with_shared_blobs_a_service_account_and_no_tasks() {
	insta::assert_snapshot!(yaml(&config(json!({
		"sharedBlobStorage": true,
		"serviceAccount": "arn:aws:iam::111111111111:role/app",
		"centralTasksReplicas": 0,
		"dbExpose": false,
	}))));
}

#[test]
fn central_rendering_is_deterministic() {
	let cfg = config(json!({}));
	assert_eq!(yaml(&cfg), yaml(&cfg));
}

#[test]
fn central_emits_no_secrets() {
	let out = tamanu_render::central::workloads(&config(json!({}))).unwrap();
	assert!(out.iter().all(|v| v["kind"] != "Secret"));
}

#[test]
fn central_render_includes_the_database_and_reporting_grants() {
	let out = tamanu_render::central::render(&config(json!({}))).unwrap();
	let has = |kind: &str, name: &str| {
		out.iter()
			.any(|v| v["kind"] == kind && v["metadata"]["name"] == name)
	};
	assert!(has("Cluster", "central-db"));
	assert!(has("Job", "central-reporting-grants"));
	assert!(has("Job", "central-migrator"));
	assert!(out.iter().all(|v| v["kind"] != "Secret"));
}
