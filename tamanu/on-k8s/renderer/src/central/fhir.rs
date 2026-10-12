//! The FHIR workers, ported from `central/fhir.ts`.

use serde_json::Value;

use crate::config::Config;

use super::specs::{PodArgs, PodSpecFactory, deployment};

const REFRESH_TOPICS: [&str; 3] = [
	"fhir.refresh.allFromUpstream",
	"fhir.refresh.entireResource",
	"fhir.refresh.fromUpstream",
];
const RESOLVER_TOPICS: [&str; 1] = ["fhir.resolver"];

pub fn fhir_workers(cfg: &Config, pods: &PodSpecFactory<'_>) -> serde_json::Result<Vec<Value>> {
	Ok(vec![
		worker(cfg, pods, "refresh", &REFRESH_TOPICS)?,
		worker(cfg, pods, "resolver", &RESOLVER_TOPICS)?,
	])
}

fn worker(
	cfg: &Config,
	pods: &PodSpecFactory<'_>,
	name: &str,
	topics: &[&str],
) -> serde_json::Result<Value> {
	let component = format!("fhir-{name}");
	let mut args = PodArgs::new(&component, ["startFhirWorker", "--topics"]);
	args.command.push(topics.join(","));
	deployment(
		cfg,
		&format!("central-{component}"),
		&component,
		cfg.replicas.central.tasks,
		false,
		pods.pod_spec(args),
	)
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::central::test_support::cfg;

	#[test]
	fn workers_listen_to_their_own_topics() {
		let cfg = cfg(json!({}));
		let pods = PodSpecFactory::new(&cfg, None);
		let out = fhir_workers(&cfg, &pods).unwrap();
		let args = |i: usize| out[i]["spec"]["template"]["spec"]["containers"][0]["args"].clone();
		assert_eq!(out[0]["metadata"]["name"], "central-fhir-refresh");
		assert_eq!(
			args(0),
			json!([
				"startFhirWorker",
				"--topics",
				"fhir.refresh.allFromUpstream,fhir.refresh.entireResource,fhir.refresh.fromUpstream"
			])
		);
		assert_eq!(out[1]["metadata"]["name"], "central-fhir-resolver");
		assert_eq!(
			args(1),
			json!(["startFhirWorker", "--topics", "fhir.resolver"])
		);
	}
}
