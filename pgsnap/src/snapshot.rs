use std::collections::BTreeMap;

use kube::{Api, Client, api::PostParams};
use semver::Version;
use serde_json::json;
use tracing::info;

use crate::util;

// spec: PGS#snapshot-creation
pub async fn create_snapshot(
    client: &Client,
    namespace: &str,
    snapshot_name: &str,
    cluster_name: &str,
    annotations: BTreeMap<String, String>,
) -> anyhow::Result<()> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &volume_snapshot_resource(),
    );

    if api.get_opt(snapshot_name).await?.is_some() {
        info!(snapshot_name, "VolumeSnapshot already exists");
        return Ok(());
    }

    // spec: PGS#passthrough-annotations
    let mut snap_annotations = annotations;
    snap_annotations.insert(
        util::ANNOTATION_CREATED_AT.to_string(),
        jiff::Zoned::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string(),
    );

    let pvc_name = format!("{cluster_name}-1");

    let snapshot = serde_json::from_value(json!({
        "apiVersion": "snapshot.storage.k8s.io/v1",
        "kind": "VolumeSnapshot",
        "metadata": {
            "name": snapshot_name,
            "namespace": namespace,
            "labels": {
                util::LABEL_MANAGED: "true",
            },
            "annotations": snap_annotations,
        },
        "spec": {
            "volumeSnapshotClassName": util::SNAPSHOT_CLASS,
            "source": {
                "persistentVolumeClaimName": pvc_name,
            },
        },
    }))?;

    api.create(&PostParams::default(), &snapshot).await?;
    info!(snapshot_name, "created VolumeSnapshot");
    Ok(())
}

// spec: PGS#snapshot-creation
pub async fn is_snapshot_ready(
    client: &Client,
    namespace: &str,
    snapshot_name: &str,
) -> anyhow::Result<bool> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &volume_snapshot_resource(),
    );

    match api.get_opt(snapshot_name).await? {
        Some(snap) => {
            let ready = snap
                .data
                .get("status")
                .and_then(|s| s.get("readyToUse"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Ok(ready)
        }
        None => Ok(false),
    }
}

pub async fn delete_snapshot(
    client: &Client,
    namespace: &str,
    name: &str,
) -> anyhow::Result<()> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &volume_snapshot_resource(),
    );
    api.delete(name, &Default::default()).await?;
    info!(name, "deleted VolumeSnapshot");
    Ok(())
}

pub async fn list_managed_snapshots(
    client: &Client,
    namespace: &str,
) -> anyhow::Result<Vec<kube::api::DynamicObject>> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &volume_snapshot_resource(),
    );

    let list = api
        .list(&kube::api::ListParams {
            label_selector: Some(format!("{MANAGED}=true", MANAGED = util::LABEL_MANAGED)),
            ..Default::default()
        })
        .await?;

    Ok(list.items)
}

pub struct ReadySnapshot {
    pub name: String,
    pub version: Version,
    pub created_at: Option<String>,
}

// spec: PGS#source-snapshot
// Resolve which existing snapshot a Job bootstraps its database from.
pub async fn resolve_source(
    client: &Client,
    namespace: &str,
    requested: &str,
    for_version: Option<&Version>,
) -> anyhow::Result<String> {
    if requested != util::FROM_SNAPSHOT_PREVIOUS {
        let ready = list_ready(client, namespace).await?;
        // A name identifies one snapshot; a for-version can identify several, so the
        // newest of those wins.
        let named = ready.iter().find(|snap| snap.name == requested).or_else(|| {
            ready
                .iter()
                .filter(|snap| snap.version.to_string() == requested)
                .max_by(|a, b| newest_first(a, b))
        });
        return named
            .map(|snap| snap.name.clone())
            .ok_or_else(|| anyhow::anyhow!("no ready snapshot matching {requested}"));
    }

    let target = for_version.ok_or_else(|| {
        anyhow::anyhow!(
            "{PREVIOUS} needs a valid semver {FOR_VERSION} to be previous to",
            PREVIOUS = util::FROM_SNAPSHOT_PREVIOUS,
            FOR_VERSION = util::ANNOTATION_FOR_VERSION,
        )
    })?;

    let candidates = list_ready(client, namespace).await?;
    pick_previous(&candidates, target)
        .ok_or_else(|| anyhow::anyhow!("no ready snapshot predates v{target}"))
}

// Newest snapshot from a minor below `target`, so migrations run against data they have
// not already been applied to. A snapshot of the same minor is skipped even at a lower
// patch, because a release branch's own snapshot already carries its migrations.
pub fn pick_previous(candidates: &[ReadySnapshot], target: &Version) -> Option<String> {
    candidates
        .iter()
        .filter(|snap| (snap.version.major, snap.version.minor) < (target.major, target.minor))
        .max_by(|a, b| newest_first(a, b))
        .map(|snap| snap.name.clone())
}

fn newest_first(a: &ReadySnapshot, b: &ReadySnapshot) -> std::cmp::Ordering {
    a.version
        .cmp(&b.version)
        .then_with(|| a.created_at.cmp(&b.created_at))
        .then_with(|| a.name.cmp(&b.name))
}

// Managed snapshots that are ready to restore from, with their parsed for-version.
async fn list_ready(client: &Client, namespace: &str) -> anyhow::Result<Vec<ReadySnapshot>> {
    Ok(list_managed_snapshots(client, namespace)
        .await?
        .into_iter()
        .filter(|snap| {
            snap.data
                .get("status")
                .and_then(|s| s.get("readyToUse"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .filter_map(|snap| {
            let name = snap.metadata.name.clone()?;
            let annotations = snap.metadata.annotations.as_ref()?;
            let version = annotations
                .get(util::ANNOTATION_FOR_VERSION)
                .and_then(|v| Version::parse(v).ok())?;
            let created_at = annotations.get(util::ANNOTATION_CREATED_AT).cloned();
            Some(ReadySnapshot { name, version, created_at })
        })
        .collect())
}

pub fn volume_snapshot_resource() -> kube::discovery::ApiResource {
    kube::discovery::ApiResource {
        group: "snapshot.storage.k8s.io".into(),
        version: "v1".into(),
        api_version: "snapshot.storage.k8s.io/v1".into(),
        kind: "VolumeSnapshot".into(),
        plural: "volumesnapshots".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(name: &str, version: &str, created_at: Option<&str>) -> ReadySnapshot {
        ReadySnapshot {
            name: name.to_string(),
            version: Version::parse(version).unwrap(),
            created_at: created_at.map(str::to_string),
        }
    }

    fn candidates() -> Vec<ReadySnapshot> {
        [("s-2-62-0", "2.62.0"), ("s-2-63-0", "2.63.0"), ("s-2-63-4", "2.63.4")]
            .into_iter()
            .map(|(n, v)| snap(n, v, None))
            .collect()
    }

    #[test]
    fn picks_the_newest_earlier_minor() {
        let target = Version::parse("2.64.0").unwrap();
        assert_eq!(pick_previous(&candidates(), &target).as_deref(), Some("s-2-63-4"));
    }

    #[test]
    fn skips_the_target_own_minor() {
        let target = Version::parse("2.63.9").unwrap();
        assert_eq!(pick_previous(&candidates(), &target).as_deref(), Some("s-2-62-0"));
    }

    #[test]
    fn breaks_a_version_tie_on_created_at() {
        let candidates = vec![
            snap("s-2-63-4-first", "2.63.4", Some("2026-08-01T00:00:00Z")),
            snap("s-2-63-4-rerun", "2.63.4", Some("2026-09-01T00:00:00Z")),
        ];
        let target = Version::parse("2.64.0").unwrap();
        assert_eq!(pick_previous(&candidates, &target).as_deref(), Some("s-2-63-4-rerun"));
    }

    #[test]
    fn none_when_nothing_predates_the_target() {
        let target = Version::parse("2.62.0").unwrap();
        assert_eq!(pick_previous(&candidates(), &target), None);
    }
}
