//! Where workloads run and how their replicas spread, ported from
//! `common/scheduling.ts`.

use k8s_openapi::api::core::v1::{
	Affinity, NodeAffinity, NodeSelector, NodeSelectorRequirement, NodeSelectorTerm,
	PreferredSchedulingTerm, Toleration, TopologySpreadConstraint,
};
use k8s_openapi::api::policy::v1::{PodDisruptionBudget, PodDisruptionBudgetSpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use serde_json::Value;

use crate::config::{Capacity, Config};
use crate::meta::Labels;
use crate::pod::spot_toleration;
use crate::waves;

pub struct Scheduling {
	pub tolerations: Option<Vec<Toleration>>,
	pub affinity: Affinity,
	pub topology_spread_constraints: Option<Vec<TopologySpreadConstraint>>,
}

fn requirement(key: &str, value: &str) -> NodeSelectorRequirement {
	NodeSelectorRequirement {
		key: key.into(),
		operator: "In".into(),
		values: Some(vec![value.into()]),
	}
}

/// The node pool, tolerations and spreading for an app workload.
///
/// `spread` selects the pods whose replicas must sit on separate nodes, so one
/// reclaim or drain never takes them all. The constraint counts only the current
/// ReplicaSet, because counting all of them lets a rolling update surge onto
/// occupied nodes.
// spec: TDR#placement
pub fn workload_scheduling(cfg: &Config, spread: Option<&Labels>) -> Scheduling {
	let mut required = vec![
		requirement("bes.node.arch", cfg.architecture.as_str()),
		requirement("bes.node.purpose", "workload"),
	];
	let topology_spread_constraints = spread.map(|selector| {
		vec![TopologySpreadConstraint {
			max_skew: 1,
			topology_key: "kubernetes.io/hostname".into(),
			when_unsatisfiable: "DoNotSchedule".into(),
			label_selector: Some(LabelSelector {
				match_labels: Some(selector.clone()),
				match_expressions: None,
			}),
			match_label_keys: Some(vec!["pod-template-hash".into()]),
			..Default::default()
		}]
	});

	let (tolerations, preferred) = match cfg.capacity {
		Capacity::OnDemand => {
			required.push(requirement("bes.node.schedule", "ondemand"));
			(None, None)
		}
		Capacity::Spot => (
			Some(vec![spot_toleration()]),
			Some(vec![PreferredSchedulingTerm {
				weight: 1,
				preference: NodeSelectorTerm {
					match_expressions: Some(vec![requirement("bes.node.schedule", "spot")]),
					match_fields: None,
				},
			}]),
		),
	};

	Scheduling {
		tolerations,
		affinity: Affinity {
			node_affinity: Some(NodeAffinity {
				preferred_during_scheduling_ignored_during_execution: preferred,
				required_during_scheduling_ignored_during_execution: Some(NodeSelector {
					node_selector_terms: vec![NodeSelectorTerm {
						match_expressions: Some(required),
						match_fields: None,
					}],
				}),
			}),
			..Default::default()
		},
		topology_spread_constraints,
	}
}

/// Lets a drain evict one replica at a time, so the others keep serving while it
/// is rescheduled.
pub fn replica_disruption_budget(
	cfg: &Config,
	name: &str,
	selector: Labels,
) -> serde_json::Result<Value> {
	let pdb = PodDisruptionBudget {
		metadata: ObjectMeta {
			name: Some(name.into()),
			namespace: Some(cfg.namespace.clone()),
			..Default::default()
		},
		spec: Some(PodDisruptionBudgetSpec {
			max_unavailable: Some(IntOrString::Int(1)),
			selector: Some(LabelSelector {
				match_labels: Some(selector),
				match_expressions: None,
			}),
			..Default::default()
		}),
		..Default::default()
	};
	Ok(waves::in_wave(serde_json::to_value(pdb)?, waves::WORKLOADS))
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;
	use crate::params::Params;

	fn cfg(capacity: &str) -> Config {
		let p: Params = serde_json::from_value(json!({
			"stack": "main",
			"imageTag": "sha-x",
			"cluster": { "fullName": "c" },
			"config": { "capacity": capacity },
		}))
		.unwrap();
		Config::derive(&p).unwrap()
	}

	fn selector() -> Labels {
		Labels::from([("app.kubernetes.io/name".to_owned(), "central".to_owned())])
	}

	#[test]
	fn spot_prefers_and_tolerates_spot() {
		let s = workload_scheduling(&cfg("spot"), None);
		assert!(s.tolerations.is_some());
		let na = s.affinity.node_affinity.unwrap();
		assert!(
			na.preferred_during_scheduling_ignored_during_execution
				.is_some()
		);
		assert!(s.topology_spread_constraints.is_none());
	}

	#[test]
	fn on_demand_requires_on_demand_nodes_and_tolerates_nothing() {
		let s = workload_scheduling(&cfg("ondemand"), None);
		assert!(s.tolerations.is_none());
		let na = s.affinity.node_affinity.unwrap();
		assert!(
			na.preferred_during_scheduling_ignored_during_execution
				.is_none()
		);
		let terms = na
			.required_during_scheduling_ignored_during_execution
			.unwrap();
		let keys: Vec<_> = terms.node_selector_terms[0]
			.match_expressions
			.as_ref()
			.unwrap()
			.iter()
			.map(|r| r.key.as_str())
			.collect();
		assert_eq!(
			keys,
			["bes.node.arch", "bes.node.purpose", "bes.node.schedule"]
		);
	}

	#[test]
	fn spreading_counts_only_the_current_replica_set() {
		let sel = selector();
		let s = workload_scheduling(&cfg("spot"), Some(&sel));
		let c = &s.topology_spread_constraints.unwrap()[0];
		assert_eq!(c.max_skew, 1);
		assert_eq!(c.topology_key, "kubernetes.io/hostname");
		assert_eq!(c.when_unsatisfiable, "DoNotSchedule");
		assert_eq!(
			c.match_label_keys.as_deref(),
			Some(&["pod-template-hash".to_owned()][..])
		);
	}

	#[test]
	fn budgets_allow_one_replica_down() {
		let pdb = replica_disruption_budget(&cfg("spot"), "central-api", selector()).unwrap();
		assert_eq!(pdb["kind"], "PodDisruptionBudget");
		assert_eq!(pdb["spec"]["maxUnavailable"], 1);
		assert_eq!(pdb["metadata"]["name"], "central-api");
	}

	#[test]
	fn invalid_capacity_is_rejected() {
		let p: Params = serde_json::from_value(json!({
			"stack": "main", "imageTag": "x", "cluster": { "fullName": "c" },
			"config": { "capacity": "weird" },
		}))
		.unwrap();
		assert!(Config::derive(&p).is_err());
	}
}
