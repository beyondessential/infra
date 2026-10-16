use std::collections::{BTreeMap, HashMap};

use kube::Client;
use semver::Version;
use tracing::{error, info, warn};

use crate::{snapshot, util};

// s[gc.schedule]
pub async fn run_loop(client: Client, namespace: &str) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
    loop {
        interval.tick().await;
        if let Err(e) = run_once(&client, namespace).await {
            error!(error = %e, "garbage collection failed");
        }
    }
}

async fn run_once(client: &Client, namespace: &str) -> anyhow::Result<()> {
    // s[gc.scope]
    let snapshots = snapshot::list_managed_snapshots(client, namespace).await?;
    if snapshots.is_empty() {
        return Ok(());
    }

    let mut parsed: Vec<SnapshotInfo> = Vec::new();
    for snap in &snapshots {
        let name = snap.metadata.name.as_deref().unwrap_or("");
        let annotations: BTreeMap<String, String> = snap
            .metadata
            .annotations
            .clone()
            .unwrap_or_default();

        // s[gc.version-parse]
        let version_str = match annotations.get(util::ANNOTATION_FOR_VERSION) {
            Some(v) => v,
            None => continue,
        };

        let version = match Version::parse(version_str) {
            Ok(v) => v,
            Err(_) => {
                warn!(snapshot = name, version = version_str, "invalid semver, skipping");
                continue;
            }
        };

        let created_at = annotations
            .get(util::ANNOTATION_CREATED_AT)
            .cloned()
            .unwrap_or_default();

        parsed.push(SnapshotInfo {
            name: name.to_string(),
            version,
            created_at,
        });
    }

    let to_retain = compute_retained(&parsed);
    let to_delete: Vec<&SnapshotInfo> = parsed.iter().filter(|s| !to_retain.contains(&s.name)).collect();

    for snap in to_delete {
        info!(snapshot = %snap.name, version = %snap.version, "deleting snapshot");
        if let Err(e) = snapshot::delete_snapshot(client, namespace, &snap.name).await {
            error!(snapshot = %snap.name, error = %e, "failed to delete snapshot");
        }
    }

    Ok(())
}

struct SnapshotInfo {
    name: String,
    version: Version,
    created_at: String,
}

fn compute_retained(snapshots: &[SnapshotInfo]) -> Vec<String> {
    let mut retained = Vec::new();

    // s[gc.dedup-version]
    let mut by_version: HashMap<String, Vec<&SnapshotInfo>> = HashMap::new();
    for snap in snapshots {
        by_version
            .entry(snap.version.to_string())
            .or_default()
            .push(snap);
    }

    let mut version_winners: Vec<&SnapshotInfo> = Vec::new();
    for group in by_version.values() {
        let latest = group.iter().max_by(|a, b| a.created_at.cmp(&b.created_at));
        if let Some(winner) = latest {
            version_winners.push(winner);
        }
    }

    // s[gc.dedup-minor]
    let mut by_minor: HashMap<(u64, u64), Vec<&SnapshotInfo>> = HashMap::new();
    for snap in &version_winners {
        by_minor
            .entry((snap.version.major, snap.version.minor))
            .or_default()
            .push(snap);
    }

    let mut minor_winners: Vec<&SnapshotInfo> = Vec::new();
    for group in by_minor.values() {
        let highest_patch = group.iter().max_by(|a, b| a.version.cmp(&b.version));
        if let Some(winner) = highest_patch {
            minor_winners.push(winner);
        }
    }

    // s[gc.retain-minors]
    minor_winners.sort_by(|a, b| b.version.cmp(&a.version));
    let kept: Vec<&SnapshotInfo> = minor_winners.into_iter().take(10).collect();

    for snap in &kept {
        retained.push(snap.name.clone());
    }

    retained
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(name: &str, version: &str, created_at: &str) -> SnapshotInfo {
        SnapshotInfo {
            name: name.to_string(),
            version: Version::parse(version).unwrap(),
            created_at: created_at.to_string(),
        }
    }

    #[test]
    fn dedup_same_version_keeps_latest() {
        let snapshots = vec![
            snap("a", "1.2.3", "2026-01-01T00:00:00Z"),
            snap("b", "1.2.3", "2026-01-02T00:00:00Z"),
        ];
        let retained = compute_retained(&snapshots);
        assert_eq!(retained, vec!["b"]);
    }

    #[test]
    fn dedup_same_minor_keeps_highest_patch() {
        let snapshots = vec![
            snap("a", "1.2.1", "2026-01-01T00:00:00Z"),
            snap("b", "1.2.3", "2026-01-02T00:00:00Z"),
            snap("c", "1.2.2", "2026-01-03T00:00:00Z"),
        ];
        let retained = compute_retained(&snapshots);
        assert_eq!(retained, vec!["b"]);
    }

    #[test]
    fn retains_last_10_minors() {
        let snapshots: Vec<SnapshotInfo> = (0..15)
            .map(|i| snap(&format!("s{i}"), &format!("1.{i}.0"), "2026-01-01T00:00:00Z"))
            .collect();
        let retained = compute_retained(&snapshots);
        assert_eq!(retained.len(), 10);
        assert!(!retained.contains(&"s0".to_string()));
        assert!(!retained.contains(&"s1".to_string()));
        assert!(!retained.contains(&"s2".to_string()));
        assert!(!retained.contains(&"s3".to_string()));
        assert!(!retained.contains(&"s4".to_string()));
        assert!(retained.contains(&"s14".to_string()));
    }
}
