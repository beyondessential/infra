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
