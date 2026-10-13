//! The rendered application and provisioning config ConfigMaps, ported from
//! `common/templatedConfig.ts`.
//!
//! Templates are Jinja-style files in a directory, one per config template name
//! (`basic`, `pr`, `rc`, `demo`, ...) laid out as `{name}/central.json5.njk`,
//! `{name}/facility.json5.njk` and `{name}/provisioning.json5.njk`. A name that
//! lacks a file falls back to `basic` for that file.
//!
//! Rendering is deterministic. The `randomstring` filter yields a fixed
//! placeholder and the real secrets reach the servers through environment
//! variables from a Secret, which take precedence over the file. A ConfigMap's
//! data is written once: the Application ignores later differences on it, so
//! per-deployment edits survive deploys.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use include_dir::{Dir, include_dir};
use k8s_openapi::api::core::v1::ConfigMap;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use minijinja::{Environment, Value as JinjaValue};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};
use url::Url;

use crate::config::{Config, DEFAULT_CONFIG_TEMPLATE, Facility};
use crate::names;
use crate::waves;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
	Central,
	Facility,
	Provisioning,
}

impl Kind {
	fn file(self) -> &'static str {
		match self {
			Self::Central => "central.json5.njk",
			Self::Facility => "facility.json5.njk",
			Self::Provisioning => "provisioning.json5.njk",
		}
	}

	/// The key the rendered file is stored under.
	fn key(self) -> &'static str {
		match self {
			Self::Central | Self::Facility => "local.json5",
			Self::Provisioning => "provisioning.json5",
		}
	}

	fn label(self) -> &'static str {
		match self {
			Self::Central => "config-central",
			Self::Facility => "config-facility",
			Self::Provisioning => "provisioning",
		}
	}
}

/// The templates built into the binary, so that one image is one complete
/// definition of how a deployment renders: there is no second thing to keep in
/// step with it.
static EMBEDDED: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/templates");

/// Where templates come from.
#[derive(Debug, Clone)]
pub enum Templates {
	/// Those compiled into the binary.
	Embedded,
	/// A directory, for trying a template without rebuilding.
	Dir(PathBuf),
}

/// The placeholder `randomstring` yields, as long as its hex encoding would be.
/// The server never sees it: environment variables override these paths.
fn placeholder(length: usize) -> String {
	"x".repeat(length * 2)
}

fn to_jinja(v: &Value) -> JinjaValue {
	match v {
		Value::Null => JinjaValue::from(()),
		Value::Bool(b) => JinjaValue::from(*b),
		Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
			(Some(i), _, _) => JinjaValue::from(i),
			(_, Some(u), _) => JinjaValue::from(u),
			(_, _, Some(f)) => JinjaValue::from(f),
			_ => JinjaValue::UNDEFINED,
		},
		Value::String(s) => JinjaValue::from(s.as_str()),
		Value::Array(a) => JinjaValue::from(a.iter().map(to_jinja).collect::<Vec<_>>()),
		Value::Object(o) => JinjaValue::from(
			o.iter()
				.map(|(k, v)| (k.clone(), to_jinja(v)))
				.collect::<BTreeMap<String, JinjaValue>>(),
		),
	}
}

fn environment() -> Environment<'static> {
	let mut env = Environment::new();
	env.add_filter("randomstring", |length: usize, _format: Option<String>| {
		placeholder(length)
	});
	env
}

impl Templates {
	fn read(&self, cfg: &Config, kind: Kind) -> Result<(String, String)> {
		for name in [cfg.config_template.as_str(), DEFAULT_CONFIG_TEMPLATE] {
			if let Some(text) = self.file(name, kind)? {
				return Ok((name.to_owned(), text));
			}
		}
		bail!(
			"no {} template for {:?} or {:?}",
			kind.file(),
			cfg.config_template,
			DEFAULT_CONFIG_TEMPLATE
		)
	}

	fn file(&self, name: &str, kind: Kind) -> Result<Option<String>> {
		match self {
			Self::Embedded => Ok(EMBEDDED
				.get_file(format!("{name}/{}", kind.file()))
				.and_then(|f| f.contents_utf8())
				.map(str::to_owned)),
			Self::Dir(dir) => {
				let path = dir.join(name).join(kind.file());
				match std::fs::read_to_string(&path) {
					Ok(text) => Ok(Some(text)),
					Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
					Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
				}
			}
		}
	}

	fn render(&self, cfg: &Config, kind: Kind, data: Value) -> Result<(String, String)> {
		let (name, source) = self.read(cfg, kind)?;
		let mut ctx = match data {
			Value::Object(m) => m,
			_ => bail!("template data must be an object"),
		};
		ctx.insert("networkV4Cidr".into(), cfg.network_v4_cidr.clone().into());
		ctx.insert("networkV6Cidr".into(), cfg.network_v6_cidr.clone().into());
		let rendered = environment()
			.render_str(&source, to_jinja(&Value::Object(ctx)))
			.with_context(|| format!("rendering {}/{}", name, kind.file()))?;
		Ok((name, rendered))
	}
}

fn config_map(
	cfg: &Config,
	name: String,
	kind: Kind,
	template_name: &str,
	data: BTreeMap<String, String>,
) -> Result<Value> {
	let cm = ConfigMap {
		metadata: ObjectMeta {
			name: Some(name),
			namespace: Some(cfg.namespace.clone()),
			labels: Some(BTreeMap::from([(
				"bes.tamanu/templated-from".to_owned(),
				format!("{}-template-{template_name}", kind.label()),
			)])),
			..Default::default()
		},
		data: Some(data),
		..Default::default()
	};
	Ok(waves::in_wave(serde_json::to_value(cm)?, waves::BASE))
}

fn parse_json5(text: &str) -> Result<Value> {
	json5::from_str(text).map_err(|e| anyhow!("provisioning template is not valid JSON5: {e}"))
}

/// The provisioning document, parsed. Facility templates read the admin sync
/// credentials from it, and the setup-sync Job needs them for the sync URL.
pub fn provisioning(cfg: &Config, templates: &Templates) -> Result<(Value, String, String)> {
	let ids: Vec<&str> = cfg.facilities.iter().map(|f| f.id.as_str()).collect();
	let (template, rendered) =
		templates.render(cfg, Kind::Provisioning, json!({ "facilityNames": ids }))?;
	let parsed = parse_json5(&rendered)?;
	Ok((parsed, rendered, template))
}

/// Everything `templatedConfig` created: the provisioning config, central's
/// application config and each facility's.
///
/// `central_env` and `facility_env` are the servers' `custom-environment-variables.json`
/// contents.
pub fn render(
	cfg: &Config,
	templates: &Templates,
	central_env: &Value,
	facility_env: &Value,
) -> Result<Vec<Value>> {
	let mut out = Vec::new();

	let (provisioning, prov_text, prov_template) = self::provisioning(cfg, templates)?;
	out.push(config_map(
		cfg,
		names::PROVISIONING_CONFIG.into(),
		Kind::Provisioning,
		&prov_template,
		BTreeMap::from([
			(Kind::Provisioning.key().into(), prov_text),
			("timezone".into(), cfg.timezone.clone()),
		]),
	)?);

	let (template, text) = templates.render(
		cfg,
		Kind::Central,
		json!({ "fqdn": cfg.domains.central, "timezone": cfg.timezone }),
	)?;
	out.push(config_map(
		cfg,
		names::app_config("central"),
		Kind::Central,
		&template,
		BTreeMap::from([
			(Kind::Central.key().into(), text),
			(
				"custom-environment-variables.json".into(),
				serde_json::to_string(central_env)?,
			),
		]),
	)?);

	let has_setup_sync = cfg.at_least_version("2.60.0-0");
	let central_api_url = central_api_url(cfg);
	for (i, facility) in cfg.facilities.iter().enumerate() {
		let instance = format!("facility-{}", i + 1);
		let (template, text) = templates.render(
			cfg,
			Kind::Facility,
			json!({
				"fqdn": cfg.domains.facilities[&facility.host],
				"instance": instance,
				"facilityId": facility.id,
				"deviceId": facility.id,
				"timezone": cfg.timezone,
				"provisioning": provisioning,
				"legacySyncConfig": !has_setup_sync,
				"centralApiUrl": central_api_url,
				"syncApiUrl": format!("http://{instance}-sync"),
				"syncApiPort": 80,
			}),
		)?;
		out.push(config_map(
			cfg,
			names::app_config(&instance),
			Kind::Facility,
			&template,
			BTreeMap::from([
				(Kind::Facility.key().into(), text),
				(
					"custom-environment-variables.json".into(),
					serde_json::to_string(facility_env)?,
				),
			]),
		)?);
	}
	Ok(out)
}

pub fn central_api_url(cfg: &Config) -> String {
	format!("https://{}", cfg.domains.central)
}

/// What a facility needs to find its way to central.
pub fn facility_host(cfg: &Config, facility: &Facility) -> String {
	cfg.domains.facilities[&facility.host].clone()
}

const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
	.remove(b'-')
	.remove(b'_')
	.remove(b'.')
	.remove(b'!')
	.remove(b'~')
	.remove(b'*')
	.remove(b'\'')
	.remove(b'(')
	.remove(b')');

/// The URL the setup-sync Job uses to log in to central as the provisioned
/// admin. Credentials are pre-encoded, because the URL setters leave `%` as it
/// is and a literal `%xx` in a password would be collapsed by the server's
/// `decodeURIComponent`.
pub fn sync_url(cfg: &Config, provisioning: &Value) -> Result<String> {
	let email = "admin@tamanu.io";
	let password = provisioning
		.pointer(&format!("/users/{email}/password"))
		.and_then(Value::as_str)
		.ok_or_else(|| anyhow!("provisioning has no password for {email}"))?;
	let mut url = Url::parse(&central_api_url(cfg))?;
	url.set_username(&utf8_percent_encode(email, COMPONENT).to_string())
		.map_err(|()| anyhow!("cannot set a username on the central URL"))?;
	url.set_password(Some(&utf8_percent_encode(password, COMPONENT).to_string()))
		.map_err(|()| anyhow!("cannot set a password on the central URL"))?;
	Ok(url.to_string())
}

pub fn templates_at(dir: impl AsRef<Path>) -> Templates {
	Templates::Dir(dir.as_ref().to_owned())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::params::Params;

	fn cfg(template: &str, version: Option<&str>) -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-abc",
			"appVersion": version,
			"cluster": { "fullName": "c", "networkV4Cidr": "10.0.0.0/16", "networkV6Cidr": "fd00::/48" },
			"config": { "configTemplate": template, "facilities": 2 },
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	fn fixtures() -> Templates {
		templates_at(concat!(
			env!("CARGO_MANIFEST_DIR"),
			"/tests/fixtures/templates"
		))
	}

	#[test]
	fn renders_provisioning_from_facility_ids() {
		let (parsed, _, template) = provisioning(&cfg("basic", None), &fixtures()).unwrap();
		assert_eq!(template, "basic");
		assert_eq!(parsed["facilities"]["facility-2"]["name"], "Facility 2");
		assert_eq!(
			parsed["users"]["admin@tamanu.io"]["password"],
			"fixture-password"
		);
	}

	#[test]
	fn missing_template_falls_back_to_basic_per_file() {
		let (_, _, template) = provisioning(&cfg("pr", None), &fixtures()).unwrap();
		assert_eq!(template, "basic");
	}

	#[test]
	fn randomstring_is_a_fixed_placeholder() {
		let maps = render(
			&cfg("basic", Some("2.66.0")),
			&fixtures(),
			&json!({}),
			&json!({}),
		)
		.unwrap();
		let central = maps
			.iter()
			.find(|m| m["metadata"]["name"] == "config-central")
			.unwrap();
		let text = central["data"]["local.json5"].as_str().unwrap();
		assert!(
			text.contains(&format!("secret: '{}'", "x".repeat(80))),
			"{text}"
		);
		let again = render(
			&cfg("basic", Some("2.66.0")),
			&fixtures(),
			&json!({}),
			&json!({}),
		)
		.unwrap();
		assert_eq!(maps, again);
	}

	#[test]
	fn facility_config_uses_provisioned_credentials_and_instance() {
		let maps = render(
			&cfg("basic", Some("2.66.0")),
			&fixtures(),
			&json!({}),
			&json!({}),
		)
		.unwrap();
		let f1 = maps
			.iter()
			.find(|m| m["metadata"]["name"] == "config-facility-1")
			.unwrap();
		let text = f1["data"]["local.json5"].as_str().unwrap();
		assert!(text.contains("password: 'fixture-password'"), "{text}");
		assert!(text.contains("location: 'First'"), "{text}");
		assert!(text.contains("host: 'http://facility-1-sync'"), "{text}");
		let f2 = maps
			.iter()
			.find(|m| m["metadata"]["name"] == "config-facility-2")
			.unwrap();
		assert!(
			f2["data"]["local.json5"]
				.as_str()
				.unwrap()
				.contains("location: 'Other'")
		);
	}

	#[test]
	fn legacy_sync_config_is_set_for_old_versions() {
		let old = render(
			&cfg("basic", Some("2.59.0")),
			&fixtures(),
			&json!({}),
			&json!({}),
		)
		.unwrap();
		let f1 = old
			.iter()
			.find(|m| m["metadata"]["name"] == "config-facility-1")
			.unwrap();
		assert!(
			f1["data"]["local.json5"]
				.as_str()
				.unwrap()
				.contains("legacy: true")
		);
	}

	#[test]
	fn network_ranges_reach_templates() {
		let maps = render(&cfg("basic", None), &fixtures(), &json!({}), &json!({})).unwrap();
		let central = maps
			.iter()
			.find(|m| m["metadata"]["name"] == "config-central")
			.unwrap();
		assert!(
			central["data"]["local.json5"]
				.as_str()
				.unwrap()
				.contains("'10.0.0.0/16', 'fd00::/48'")
		);
	}

	#[test]
	fn sync_url_encodes_credentials() {
		let c = cfg("basic", None);
		let url = sync_url(
			&c,
			&json!({"users": {"admin@tamanu.io": {"password": "p%41 ss/"}}}),
		)
		.unwrap();
		assert_eq!(
			url,
			"https://admin%40tamanu.io:p%2541%20ss%2F@central.main.cd.tamanu.app/"
		);
	}

	#[test]
	fn config_maps_are_labelled_with_their_template() {
		let maps = render(&cfg("basic", None), &fixtures(), &json!({}), &json!({})).unwrap();
		let prov = maps
			.iter()
			.find(|m| m["metadata"]["name"] == "provisioning")
			.unwrap();
		assert_eq!(
			prov["metadata"]["labels"]["bes.tamanu/templated-from"],
			"provisioning-template-basic"
		);
		assert_eq!(prov["data"]["timezone"], "Pacific/Auckland");
	}
}
