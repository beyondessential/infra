//! Every committed template must render, for each facility count a deployment
//! might have, so a template edit that breaks one fails here and not at deploy.

use std::path::PathBuf;

use serde_json::json;
use tamanu_render::Options;
use tamanu_render::params::Params;

fn templates_dir() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates")
}

fn template_names() -> Vec<String> {
	let mut names: Vec<_> = std::fs::read_dir(templates_dir())
		.unwrap()
		.filter_map(Result::ok)
		.filter(|e| e.path().is_dir())
		.map(|e| e.file_name().into_string().unwrap())
		.collect();
	names.sort();
	names
}

#[test]
fn every_template_renders() {
	let names = template_names();
	assert!(!names.is_empty(), "no templates found");
	for name in names {
		for facilities in [1, 3] {
			for app_version in ["2.59.0", "2.67.0"] {
				let p: Params = serde_json::from_value(json!({
					"stack": "main",
					"imageTag": "sha-abc",
					"appVersion": app_version,
					"cluster": {
						"fullName": "c",
						"networkV4Cidr": "10.0.0.0/16",
						"networkV6Cidr": "fd00::/48",
					},
					"config": { "configTemplate": name, "facilities": facilities },
				}))
				.unwrap();
				let options = Options {
					templates: Some(templates_dir()),
				};
				tamanu_render::render_with(&p, &options).unwrap_or_else(|e| {
					panic!("template {name}, {facilities} facilities, {app_version}: {e:#}")
				});
			}
		}
	}
}

#[test]
fn no_template_embeds_a_real_looking_secret() {
	for name in template_names() {
		for entry in std::fs::read_dir(templates_dir().join(&name)).unwrap() {
			let path = entry.unwrap().path();
			let text = std::fs::read_to_string(&path).unwrap();
			let long_hex = text
				.split(|c: char| !c.is_ascii_hexdigit())
				.any(|run| run.len() >= 32);
			assert!(!long_hex, "{} holds a long hex string", path.display());
		}
	}
}
