//! The scheduled task runner, ported from `central/tasks.ts`.

use serde_json::Value;

use crate::config::Config;

use super::specs::{PodArgs, PodSpecFactory, deployment};

pub fn tasks(cfg: &Config, pods: &PodSpecFactory<'_>) -> serde_json::Result<Value> {
	deployment(
		cfg,
		"central-tasks",
		"task-runner",
		u32::from(cfg.replicas.central.tasks > 0),
		true,
		pods.pod_spec(PodArgs::new("task-runner", ["tasks"])),
	)
}
