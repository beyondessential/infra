//! Serves retired hostnames with a permanent redirect, ported from
//! `common/redirect.ts`.
//!
//! One Gateway carries a listener per hostname, which makes external-dns
//! publish the records and cert-manager issue the certificates. Each route
//! names its hostname: a route attached to a multi-listener Gateway without
//! one would apply to every listener.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use url::Url;

use crate::config::Config;
use crate::gateway::{gateway, http_route, https_listener, parent_ref};

/// Hostnames are valid listener names, but not valid resource names.
fn slug(host: &str) -> String {
	host.replace('.', "-")
}

pub fn redirect_sites(cfg: &Config) -> Result<Vec<Value>> {
	if cfg.redirects.is_empty() {
		return Ok(vec![]);
	}

	// BTreeMap iterates in sorted host order.
	let hosts: Vec<&String> = cfg.redirects.keys().collect();
	let mut out = gateway(
		cfg,
		"redirects",
		hosts
			.iter()
			.map(|h| https_listener(h, h, "redirects-termination-tls"))
			.collect(),
	);

	for host in hosts {
		let raw = &cfg.redirects[host];
		let target = Url::parse(raw)
			.with_context(|| format!("Redirect target for {host} is not a URL: {raw}"))?;
		if target.path() != "/" && !target.path().is_empty() {
			// The redirect preserves the request path, so a target path would be
			// silently dropped. Fail rather than mislead.
			bail!("Redirect target for {host} must not have a path: {raw}");
		}
		let Some(target_host) = target.host_str() else {
			bail!("Redirect target for {host} has no hostname: {raw}");
		};

		out.push(http_route(
			cfg,
			&format!("redirect-{}", slug(host)),
			json!({
				"parentRefs": [parent_ref(cfg, "redirects")],
				"hostnames": [host],
				"rules": [{
					"filters": [{
						"type": "RequestRedirect",
						"requestRedirect": {
							"scheme": target.scheme(),
							"hostname": target_host,
							"statusCode": 301,
						},
					}],
				}],
			}),
		));
	}
	Ok(out)
}
