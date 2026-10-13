use serde_json::{Value, json};
use tamanu_render::Options;
use tamanu_render::params::Params;

fn options() -> Options {
	Options {
		templates: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/templates").into()),
	}
}

fn params(extra_config: Value) -> Params {
	serde_json::from_value(json!({
		"stack": "main",
		"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
		"appVersion": "2.67.0",
		"cluster": { "fullName": "tamanu-internal-main" },
		"config": extra_config,
	}))
	.unwrap()
}

fn render_yaml(p: &Params) -> String {
	tamanu_render::to_yaml(&tamanu_render::render_with(p, &options()).unwrap()).unwrap()
}

#[test]
fn default_deployment() {
	insta::assert_snapshot!(render_yaml(&params(
		json!({ "nodeEnv": "staging", "patientPortalReplicas": 1 })
	)));
}

#[test]
fn rendering_is_deterministic() {
	let p = params(json!({ "facilities": 3 }));
	assert_eq!(render_yaml(&p), render_yaml(&p));
}

#[test]
fn redirects_add_a_gateway_and_routes() {
	let p = params(json!({
		"redirects": {
			"old.example.org": "https://new.example.org",
			"older.example.org": "https://new.example.org",
		},
	}));
	let out = tamanu_render::render_with(&p, &options()).unwrap();
	let kinds_names: Vec<_> = out
		.iter()
		.filter(|v| {
			v["metadata"]["name"]
				.as_str()
				.is_some_and(|n| n.starts_with("redirect"))
		})
		.map(|v| format!("{} {}", v["kind"], v["metadata"]["name"]))
		.collect();
	insta::assert_debug_snapshot!(kinds_names);
}

#[test]
fn redirect_targets_with_a_path_are_rejected() {
	let p =
		params(json!({ "redirects": { "old.example.org": "https://new.example.org/somewhere" } }));
	let err = tamanu_render::render_with(&p, &options())
		.unwrap_err()
		.to_string();
	assert!(err.contains("must not have a path"), "{err}");
}

#[test]
fn unknown_config_keys_are_rejected() {
	let err = serde_json::from_value::<Params>(json!({
		"stack": "main",
		"imageTag": "x",
		"cluster": { "fullName": "c" },
		"config": { "notAKey": 1 },
	}))
	.unwrap_err()
	.to_string();
	assert!(err.contains("unknown field"), "{err}");
}

#[test]
fn no_secret_resources_in_output() {
	let out = tamanu_render::render_with(&params(json!({})), &options()).unwrap();
	assert!(
		out.iter().all(|v| v["kind"] != "Secret"),
		"renderer must not emit Secrets"
	);
}

fn find<'a>(out: &'a [Value], kind: &str, name: &str) -> &'a Value {
	out.iter()
		.find(|v| v["kind"] == kind && v["metadata"]["name"] == name)
		.unwrap_or_else(|| panic!("no {kind} {name}"))
}

#[test]
fn on_demand_capacity_reaches_every_workload_and_database() {
	let out =
		tamanu_render::render_with(&params(json!({ "capacity": "ondemand" })), &options()).unwrap();

	for d in out.iter().filter(|v| v["kind"] == "Deployment") {
		let pod = &d["spec"]["template"]["spec"];
		assert!(pod["tolerations"].is_null(), "{}", d["metadata"]["name"]);
		let exprs = &pod["affinity"]["nodeAffinity"]["requiredDuringSchedulingIgnoredDuringExecution"]
			["nodeSelectorTerms"][0]["matchExpressions"];
		assert!(
			exprs
				.as_array()
				.unwrap()
				.iter()
				.any(|e| e["key"] == "bes.node.schedule" && e["values"][0] == "ondemand"),
			"{}",
			d["metadata"]["name"]
		);
	}

	let cluster = find(&out, "Cluster", "central-db");
	assert_eq!(
		cluster["spec"]["affinity"]["nodeSelector"]["bes.node.schedule"],
		"ondemand"
	);
	assert_eq!(
		cluster["spec"]["affinity"]["podAntiAffinityType"],
		"required"
	);
	assert!(cluster["spec"]["affinity"]["tolerations"].is_null());
}

#[test]
fn spot_capacity_is_the_default() {
	let out = tamanu_render::render_with(&params(json!({})), &options()).unwrap();
	let cluster = find(&out, "Cluster", "central-db");
	assert!(cluster["spec"]["affinity"]["nodeSelector"]["bes.node.schedule"].is_null());
	assert!(!cluster["spec"]["affinity"]["tolerations"].is_null());
}

#[test]
fn clusters_switch_over_before_updating_the_primary() {
	let out = tamanu_render::render_with(&params(json!({})), &options()).unwrap();
	assert_eq!(
		find(&out, "Cluster", "facility-1-db")["spec"]["primaryUpdateMethod"],
		"switchover"
	);
}

#[test]
fn replicated_servers_spread_across_nodes_and_keep_a_budget() {
	let out = tamanu_render::render_with(&params(json!({})), &options()).unwrap();
	for name in [
		"central-api",
		"central-web",
		"facility-1-api",
		"facility-1-web",
		"patient-portal-web",
	] {
		let d = find(&out, "Deployment", name);
		let spread = &d["spec"]["template"]["spec"]["topologySpreadConstraints"][0];
		assert_eq!(spread["topologyKey"], "kubernetes.io/hostname", "{name}");
		assert_eq!(spread["matchLabelKeys"][0], "pod-template-hash", "{name}");
		assert_eq!(
			find(&out, "PodDisruptionBudget", name)["spec"]["maxUnavailable"],
			1,
			"{name}"
		);
	}
	// Task runners and workers are single-instance and do not spread.
	let tasks = find(&out, "Deployment", "central-tasks");
	assert!(tasks["spec"]["template"]["spec"]["topologySpreadConstraints"].is_null());
}

#[test]
fn synthetic_tests_enable_the_random_api_on_the_servers() {
	let has = |out: &[Value], name: &str| {
		find(out, "Deployment", name)["spec"]["template"]["spec"]["containers"][0]["env"]
			.as_array()
			.unwrap()
			.iter()
			.any(|e| e["name"] == "TAMANU_ENABLE_SYNTHETIC_RANDOM_API")
	};
	let on =
		tamanu_render::render_with(&params(json!({ "syntheticTests": true })), &options()).unwrap();
	assert!(has(&on, "central-api"));
	assert!(has(&on, "facility-1-api"));
	assert!(has(&on, "facility-1-sync"));
	assert!(!has(&on, "central-tasks"));

	let off = tamanu_render::render_with(&params(json!({})), &options()).unwrap();
	assert!(!has(&off, "central-api"));
}
