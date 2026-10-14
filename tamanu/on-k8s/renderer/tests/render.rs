use serde_json::{Value, json};
use tamanu_renderer::Options;
use tamanu_renderer::params::Params;

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
	tamanu_renderer::to_yaml(&tamanu_renderer::render_with(p, &options()).unwrap()).unwrap()
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
	let out = tamanu_renderer::render_with(&p, &options()).unwrap();
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
	let err = tamanu_renderer::render_with(&p, &options())
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
	let out = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
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
	let out = tamanu_renderer::render_with(&params(json!({ "capacity": "ondemand" })), &options())
		.unwrap();

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
	let out = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
	let cluster = find(&out, "Cluster", "central-db");
	assert!(cluster["spec"]["affinity"]["nodeSelector"]["bes.node.schedule"].is_null());
	assert!(!cluster["spec"]["affinity"]["tolerations"].is_null());
}

#[test]
fn clusters_switch_over_before_updating_the_primary() {
	let out = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
	assert_eq!(
		find(&out, "Cluster", "facility-1-db")["spec"]["primaryUpdateMethod"],
		"switchover"
	);
}

#[test]
fn replicated_servers_spread_across_nodes_and_keep_a_budget() {
	let out = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
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
	let on = tamanu_renderer::render_with(&params(json!({ "syntheticTests": true })), &options())
		.unwrap();
	assert!(has(&on, "central-api"));
	assert!(has(&on, "facility-1-api"));
	assert!(has(&on, "facility-1-sync"));
	assert!(!has(&on, "central-tasks"));

	let off = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
	assert!(!has(&off, "central-api"));
}

#[test]
fn stack_config_as_pulumi_stores_it_renders_the_same_as_typed_config() {
	let typed = params(json!({
		"facilities": 3,
		"facilityNames": ["kule", { "id": "Bravo", "host": "b" }],
		"patientPortalReplicas": 1,
		"capacity": "ondemand",
		"dbExpose": false,
		"backupsEnabled": false,
		"redirects": { "old.example.org": "https://new.example.org" },
	}));
	// Every value a string, as `pulumi config` holds it, with unset options "null".
	let strings = params(json!({
		"facilities": "3",
		"facilityNames": "[\"kule\", {\"id\": \"Bravo\", \"host\": \"b\"}]",
		"patientPortalReplicas": "1",
		"capacity": "ondemand",
		"dbExpose": "false",
		"backupsEnabled": "false",
		"redirects": "{\"old.example.org\": \"https://new.example.org\"}",
		"timezone": "null",
		"dbStorage": "null",
		"syntheticTests": "null",
	}));
	assert_eq!(render_yaml(&typed), render_yaml(&strings));
}

#[test]
fn keys_the_program_has_but_nothing_renders_are_accepted() {
	let p = params(json!({ "ttlHours": "24", "ipAllowList": "null" }));
	tamanu_renderer::render_with(&p, &options()).unwrap();
}

#[test]
fn a_value_of_the_wrong_type_is_rejected_with_the_value_in_the_message() {
	let err = serde_json::from_value::<Params>(json!({
		"stack": "main",
		"imageTag": "x",
		"cluster": { "fullName": "c" },
		"config": { "facilities": "many" },
	}))
	.unwrap_err()
	.to_string();
	assert!(err.contains("many"), "{err}");
}

fn wave(v: &Value) -> Option<&str> {
	v.pointer("/metadata/annotations/argocd.argoproj.io~1sync-wave")
		.and_then(Value::as_str)
}

/// Argo CD marks a route unhealthy while its backend Service is missing, and
/// a wave only completes once everything in it is healthy. So routes, and
/// everything else that depends on the workloads, must come after the wave
/// that creates the Services.
#[test]
fn services_and_routes_are_never_in_the_base_wave() {
	let p = params(json!({
		"redirects": { "old.example.org": "https://new.example.org" },
		"patientPortalReplicas": 1,
		"facilities": 2,
	}));
	let out = tamanu_renderer::render_with(&p, &options()).unwrap();
	let late = [
		"Service",
		"Deployment",
		"Gateway",
		"HTTPRoute",
		"ClientTrafficPolicy",
		"PodDisruptionBudget",
	];
	let early: Vec<_> = out
		.iter()
		.filter(|v| late.contains(&v["kind"].as_str().unwrap_or("")))
		.filter(|v| wave(v) != Some("3"))
		.map(|v| format!("{} {} wave {:?}", v["kind"], v["metadata"]["name"], wave(v)))
		.collect();
	assert!(early.is_empty(), "not in the workloads wave: {early:#?}");
}

#[test]
fn synthetic_tests_run_an_artillery_deployment_aimed_at_every_server() {
	let on = tamanu_renderer::render_with(
		&params(json!({ "syntheticTests": true, "facilities": 2 })),
		&options(),
	)
	.unwrap();
	let deployment = find(&on, "Deployment", "synthetic-tests");
	let env = &deployment["spec"]["template"]["spec"]["containers"][0]["env"];
	let value = |name: &str| {
		env.as_array()
			.unwrap()
			.iter()
			.find(|e| e["name"] == name)
			.unwrap()["value"]
			.as_str()
			.unwrap()
			.to_owned()
	};
	insta::assert_debug_snapshot!((
		value("CENTRAL_TARGETS"),
		value("FACILITY_TARGETS"),
		deployment["spec"]["template"]["spec"]["containers"][0]["image"].clone(),
	));

	let off = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
	assert!(
		off.iter()
			.all(|v| v["metadata"]["name"] != "synthetic-tests")
	);
}

fn seeded(config: Value) -> Params {
	serde_json::from_value(json!({
		"stack": "main",
		"imageTag": "sha-a25d1d40354fd2d38442bce75328310ca37abae9",
		"appVersion": "2.67.0",
		"cluster": { "fullName": "tamanu-internal-main" },
		"config": config,
		"seed": { "snapshot": "seed-snapshot" },
	}))
	.unwrap()
}

#[test]
fn a_seed_snapshot_restores_central_and_tops_it_up_after_the_sync() {
	let out = tamanu_renderer::render_with(
		&seeded(json!({ "seedSnapshot": "true", "nodeEnv": "staging" })),
		&options(),
	)
	.unwrap();
	assert_eq!(
		find(&out, "Cluster", "central-db")["spec"]["bootstrap"],
		json!({ "recovery": { "volumeSnapshots": { "storage": {
			"apiGroup": "snapshot.storage.k8s.io",
			"kind": "VolumeSnapshot",
			"name": "seed-snapshot",
		} } } })
	);
	assert!(
		find(&out, "Cluster", "facility-1-db")["spec"]["bootstrap"]
			.get("recovery")
			.is_none(),
		"only central is restored"
	);
	let job = out
		.iter()
		.find(|v| {
			v["kind"] == "Job"
				&& v["metadata"]["name"]
					.as_str()
					.is_some_and(|n| n.starts_with("central-seed-top-up-"))
		})
		.expect("a seed top-up Job");
	assert!(job["metadata"]["annotations"]["argocd.argoproj.io/hook"].is_null());
}

#[test]
fn a_seed_snapshot_is_refused_for_a_production_deployment() {
	let err = tamanu_renderer::render_with(&seeded(json!({ "seedSnapshot": "true" })), &options())
		.unwrap_err()
		.to_string();
	assert!(err.contains("not production"), "{err}");
}

#[test]
fn without_a_seed_snapshot_the_database_starts_empty() {
	let out = tamanu_renderer::render_with(&params(json!({})), &options()).unwrap();
	assert!(
		find(&out, "Cluster", "central-db")["spec"]["bootstrap"]
			.get("recovery")
			.is_none()
	);
	assert!(out.iter().all(|v| {
		!v["metadata"]["name"]
			.as_str()
			.is_some_and(|n| n.starts_with("central-seed-top-up"))
	}));
}
