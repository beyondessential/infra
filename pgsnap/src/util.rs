use std::env;

use anyhow::{Context, Result};

pub const ANNOTATION_PREFIX: &str = "pgsnap.bes.au/";
pub const ANNOTATION_CREATE: &str = "pgsnap.bes.au/create";
pub const ANNOTATION_SIZE: &str = "pgsnap.bes.au/size";
pub const ANNOTATION_CPU: &str = "pgsnap.bes.au/cpu";
pub const ANNOTATION_MEMORY: &str = "pgsnap.bes.au/memory";
pub const ANNOTATION_PHASE: &str = "pgsnap.bes.au/phase";
pub const ANNOTATION_CLUSTER_NAME: &str = "pgsnap.bes.au/cluster-name";
pub const ANNOTATION_SNAPSHOT_NAME: &str = "pgsnap.bes.au/snapshot-name";
pub const ANNOTATION_CREATED_AT: &str = "pgsnap.bes.au/created-at";
pub const ANNOTATION_FOR_VERSION: &str = "pgsnap.bes.au/for-version";

pub const LABEL_CREATE: &str = "pgsnap.bes.au/create";
pub const LABEL_MANAGED: &str = "pgsnap.bes.au/managed";

pub const DEFAULT_STORAGE_SIZE: &str = "20Gi";
pub const DEFAULT_CPU: &str = "250m";
pub const DEFAULT_MEMORY: &str = "1Gi";
pub const SNAPSHOT_CLASS: &str = "ebs-retain";

// s[annotation.passthrough]
pub const EXCLUDED_ANNOTATIONS: &[&str] = &[
    ANNOTATION_CREATE,
    ANNOTATION_SIZE,
    ANNOTATION_CPU,
    ANNOTATION_MEMORY,
    ANNOTATION_PHASE,
    ANNOTATION_CLUSTER_NAME,
    ANNOTATION_SNAPSHOT_NAME,
];

pub fn operator_namespace() -> Result<String> {
    env::var("OPERATOR_NAMESPACE")
        .or_else(|_| {
            std::fs::read_to_string("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
                .map(|s| s.trim().to_string())
        })
        .context("cannot determine operator namespace: set OPERATOR_NAMESPACE or run in-cluster")
}

pub fn passthrough_annotations(
    annotations: &std::collections::BTreeMap<String, String>,
) -> std::collections::BTreeMap<String, String> {
    annotations
        .iter()
        .filter(|(k, _)| k.starts_with(ANNOTATION_PREFIX) && !EXCLUDED_ANNOTATIONS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

pub fn cluster_name_for_job(job_name: &str) -> String {
    format!("pgsnap-{job_name}")
}

pub fn secret_name_for_job(job_name: &str) -> String {
    format!("pgsnap-{job_name}")
}

pub fn snapshot_name_for_job(job_name: &str) -> String {
    let ts = jiff::Zoned::now()
        .strftime("%Y%m%d%H%M%S")
        .to_string();
    format!("pgsnap-{job_name}-{ts}")
}
