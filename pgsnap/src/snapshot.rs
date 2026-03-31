use std::collections::BTreeMap;

use kube::{Api, Client, api::PostParams};
use serde_json::json;
use tracing::info;

use crate::util;

// s[create.snapshot] s[create.snapshot.labels] s[create.snapshot.annotations]
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

    // s[annotation.created-at]
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

// s[create.snapshot.ready]
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

pub fn volume_snapshot_resource() -> kube::discovery::ApiResource {
    kube::discovery::ApiResource {
        group: "snapshot.storage.k8s.io".into(),
        version: "v1".into(),
        api_version: "snapshot.storage.k8s.io/v1".into(),
        kind: "VolumeSnapshot".into(),
        plural: "volumesnapshots".into(),
    }
}
