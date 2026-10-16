//! The parameters the infrastructure sends each channel, as committed by the stub's own test in
//! `pulumi/tamanu/on-k8s`. This renderer is canary's, so it has to accept canary's.
//! The published stable image is checked against `stable.json` by CI.

use tamanu_renderer::Options;
use tamanu_renderer::params::Params;

fn options() -> Options {
	Options {
		templates: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/templates").into()),
		..Options::default()
	}
}

// spec: TRO#parameters
#[test]
fn canary_params_from_the_stub_render() {
	let raw = include_str!("fixtures/stub/canary.json");
	let params: Params =
		serde_json::from_str(raw).expect("the renderer accepts what the stub sends canary");
	let resources = tamanu_renderer::render_with(&params, &options()).expect("and renders it");
	assert!(!resources.is_empty());
}
