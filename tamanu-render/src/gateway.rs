//! Gateway API resources: a Gateway with its Envoy ClientTrafficPolicy, and the
//! routes a deployment host needs. Ported from `common/ingress.ts` and
//! `common/k8s/gateway`.
//!
//! Custom resources are built as plain JSON until typed bindings are generated
//! from the pinned CRDs.

use anyhow::Result;
use serde_json::{Map, Value, json};

use crate::config::Config;

pub const API_GROUP: &str = "gateway.networking.k8s.io";
pub const API_VERSION: &str = "gateway.networking.k8s.io/v1";
pub const EG_API_VERSION: &str = "gateway.envoyproxy.io/v1alpha1";
pub const GATEWAY_CLASS_ENVOY: &str = "envoy-gateway";

fn cert_manager_annotations() -> Value {
	json!({
		"cert-manager.io/cluster-issuer": "letsencrypt",
		"cert-manager.io/private-key-algorithm": "ECDSA",
	})
}

/// A Gateway and the ClientTrafficPolicy that enables HTTP/3 on it.
///
/// Client IP is preserved at the IP layer on the NLB target group, so Envoy sees
/// the real source address without PROXY protocol, which cannot be combined
/// with HTTP/3.
pub fn gateway(cfg: &Config, name: &str, listeners: Vec<Value>) -> Vec<Value> {
	vec![
		json!({
			"apiVersion": API_VERSION,
			"kind": "Gateway",
			"metadata": {
				"name": name,
				"namespace": cfg.namespace,
				"annotations": cert_manager_annotations(),
			},
			"spec": {
				"gatewayClassName": GATEWAY_CLASS_ENVOY,
				"listeners": listeners,
			},
		}),
		json!({
			"apiVersion": EG_API_VERSION,
			"kind": "ClientTrafficPolicy",
			"metadata": {
				"name": format!("{name}-traffic-policy"),
				"namespace": cfg.namespace,
			},
			"spec": {
				"http3": {},
				"targetRefs": [{
					"group": API_GROUP,
					"kind": "Gateway",
					"name": name,
				}],
			},
		}),
	]
}

pub fn https_listener(name: &str, host: &str, tls_secret: &str) -> Value {
	json!({
		"name": name,
		"hostname": host,
		"port": 443,
		"protocol": "HTTPS",
		"tls": {
			"mode": "Terminate",
			"certificateRefs": [{ "kind": "Secret", "name": tls_secret }],
		},
	})
}

pub fn parent_ref(cfg: &Config, gateway: &str) -> Value {
	json!({
		"group": API_GROUP,
		"kind": "Gateway",
		"namespace": cfg.namespace,
		"name": gateway,
	})
}

pub fn http_route(cfg: &Config, name: &str, spec: Value) -> Value {
	json!({
		"apiVersion": API_VERSION,
		"kind": "HTTPRoute",
		"metadata": { "name": name, "namespace": cfg.namespace },
		"spec": spec,
	})
}

/// One host: a Gateway and its routes. Explicit timeouts replace Envoy's 15s
/// default: 60s for everything, except data imports, which run synchronously
/// within one request and can take minutes. The longest path prefix wins, so
/// the import routes take precedence over `/api` and `/v1`.
pub fn ingress(
	cfg: &Config,
	name: &str,
	host: &str,
	api_service: &str,
	web_service: &str,
) -> Result<Vec<Value>> {
	let mut out = gateway(
		cfg,
		name,
		vec![https_listener(
			name,
			host,
			&format!("{name}-termination-tls"),
		)],
	);

	let route = |route_name: &str, path: &str, backend: &str, timeout: &str| {
		let mut spec = Map::new();
		spec.insert("parentRefs".into(), json!([parent_ref(cfg, name)]));
		spec.insert(
			"rules".into(),
			json!([{
				"matches": [{ "path": { "value": path } }],
				"backendRefs": [{ "namespace": cfg.namespace, "name": backend, "port": 80 }],
				"timeouts": { "request": timeout },
			}]),
		);
		http_route(cfg, &format!("{name}-{route_name}"), Value::Object(spec))
	};

	out.push(route("frontend", "/", web_service, "60s"));
	out.push(route("api", "/api", api_service, "60s"));
	out.push(route("api-legacy", "/v1", api_service, "60s"));
	out.push(route(
		"api-import",
		"/api/admin/import",
		api_service,
		"600s",
	));
	out.push(route(
		"api-import-legacy",
		"/v1/admin/import",
		api_service,
		"600s",
	));
	Ok(out)
}
