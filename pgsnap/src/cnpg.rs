use k8s_openapi::api::core::v1::{Endpoints, Secret};
use kube::{Api, Client, api::PostParams};
use serde_json::json;
use tracing::info;

use crate::util;

pub struct JobOwner<'a> {
    pub name: &'a str,
    pub uid: &'a str,
}

pub struct ClusterSpec<'a> {
    pub storage_size: &'a str,
    pub cpu: &'a str,
    pub memory: &'a str,
    pub from_snapshot: Option<&'a str>,
}

// s[create.cluster] s[create.cluster.postgres-major] s[create.cluster.from-snapshot]
pub async fn create_cluster(
    client: &Client,
    namespace: &str,
    cluster_name: &str,
    spec: &ClusterSpec<'_>,
    owner: &JobOwner<'_>,
) -> anyhow::Result<()> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &cnpg_cluster_resource(),
    );

    if api.get_opt(cluster_name).await?.is_some() {
        info!(cluster_name, "CNPG Cluster already exists");
        return Ok(());
    }

    let mut manifest = json!({
        "apiVersion": "postgresql.cnpg.io/v1",
        "kind": "Cluster",
        "metadata": {
            "name": cluster_name,
            "namespace": namespace,
            "ownerReferences": [job_owner_ref(owner)],
        },
        "spec": {
            // Must track DEFAULT_POSTGRES_VERSION in pulumi/constants/internal.ts:
            // snapshots are physical data directories restored into those clusters.
            "imageCatalogRef": {
                "apiGroup": "postgresql.cnpg.io",
                "kind": "ClusterImageCatalog",
                "name": "postgresql",
                "major": 18,
            },
            "instances": 1,
            "primaryUpdateStrategy": "unsupervised",
            "storage": { "size": spec.storage_size },
            "resources": {
                "requests": { "memory": spec.memory, "cpu": spec.cpu },
                "limits": { "memory": spec.memory, "cpu": spec.cpu },
            },
            "postgresql": {
                "parameters": {
                    "shared_buffers": "128MB",
                    "max_wal_size": "2GB",
                    "checkpoint_timeout": "15min",
                    "synchronous_commit": "off",
                    "archive_mode": "off",
                }
            },
            "affinity": {
                "nodeSelector": { "bes.node.purpose": "workload" },
            },
            // A restored data directory brings its own roles, so the app user's password
            // is whatever the source cluster generated. CNPG reconciles the superuser
            // password after bootstrap, which is why that is the credential handed out.
            "enableSuperuserAccess": spec.from_snapshot.is_some(),
        },
    });

    // CNPG initialises an empty database when bootstrap is absent, which an empty object
    // is not: it has to stay off the manifest entirely.
    if let Some(snapshot_name) = spec.from_snapshot {
        manifest["spec"]["bootstrap"] = json!({
            "recovery": {
                "volumeSnapshots": {
                    // CNPG validates this as a core/v1 TypedLocalObjectReference, which
                    // wants apiGroup and kind as strings.
                    "storage": {
                        "apiGroup": "snapshot.storage.k8s.io",
                        "kind": "VolumeSnapshot",
                        "name": snapshot_name,
                    },
                },
            },
        });
    }

    let cluster = serde_json::from_value(manifest)?;

    api.create(&PostParams::default(), &cluster).await?;
    info!(cluster_name, "created CNPG Cluster");
    Ok(())
}

// s[create.cluster.ready]
pub async fn is_cluster_ready(
    client: &Client,
    namespace: &str,
    cluster_name: &str,
) -> anyhow::Result<bool> {
    let ep_api: Api<Endpoints> = Api::namespaced(client.clone(), namespace);
    let rw_name = format!("{cluster_name}-rw");

    match ep_api.get_opt(&rw_name).await? {
        Some(ep) => {
            let ready = ep
                .subsets
                .as_ref()
                .and_then(|s| s.first())
                .and_then(|s| s.addresses.as_ref())
                .is_some_and(|a| !a.is_empty());
            Ok(ready)
        }
        None => Ok(false),
    }
}

// s[create.secret] s[create.cluster.from-snapshot]
pub async fn create_connection_secret(
    client: &Client,
    namespace: &str,
    job_name: &str,
    cluster_name: &str,
    restored: bool,
    owner: &JobOwner<'_>,
) -> anyhow::Result<()> {
    let secret_api: Api<Secret> = Api::namespaced(client.clone(), namespace);
    let secret_name = util::secret_name_for_job(job_name);

    if secret_api.get_opt(&secret_name).await?.is_some() {
        return Ok(());
    }

    let (db_user, secret_suffix) = if restored {
        ("postgres", "superuser")
    } else {
        ("app", "app")
    };

    let cnpg_secret_name = format!("{cluster_name}-{secret_suffix}");
    let cnpg_secret = secret_api
        .get(&cnpg_secret_name)
        .await
        .map_err(|e| anyhow::anyhow!("CNPG secret {cnpg_secret_name} not found: {e}"))?;

    let data = cnpg_secret.data.unwrap_or_default();
    let password = data
        .get("password")
        .map(|v| String::from_utf8_lossy(&v.0).into_owned())
        .unwrap_or_default();

    let db_host = format!("{cluster_name}-rw.{namespace}.svc.cluster.local");

    let secret: Secret = serde_json::from_value(json!({
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": secret_name,
            "namespace": namespace,
            "ownerReferences": [job_owner_ref(owner)],
        },
        "stringData": {
            "DB_HOST": db_host,
            "DB_PORT": "5432",
            "DB_NAME": "app",
            "DB_USERNAME": db_user,
            "DB_PASSWORD": password,
        },
    }))?;

    secret_api.create(&PostParams::default(), &secret).await?;
    info!(secret_name, "created connection secret");
    Ok(())
}

pub async fn delete_cluster(
    client: &Client,
    namespace: &str,
    cluster_name: &str,
) -> anyhow::Result<()> {
    let api: Api<kube::api::DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &cnpg_cluster_resource(),
    );

    if api.get_opt(cluster_name).await?.is_some() {
        api.delete(cluster_name, &Default::default()).await?;
        info!(cluster_name, "deleted CNPG Cluster");
    }

    let secret_api: Api<Secret> = Api::namespaced(client.clone(), namespace);
    let secret_name = format!("pgsnap-{}", cluster_name.strip_prefix("pgsnap-").unwrap_or(cluster_name));
    if secret_api.get_opt(&secret_name).await?.is_some() {
        secret_api.delete(&secret_name, &Default::default()).await?;
        info!(secret_name, "deleted connection secret");
    }

    Ok(())
}

fn cnpg_cluster_resource() -> kube::discovery::ApiResource {
    kube::discovery::ApiResource {
        group: "postgresql.cnpg.io".into(),
        version: "v1".into(),
        api_version: "postgresql.cnpg.io/v1".into(),
        kind: "Cluster".into(),
        plural: "clusters".into(),
    }
}

// s[create.cleanup]
// blockOwnerDeletion=false: don't hold the Job alive on the dependent's account.
// controller=false: this Job is not the reconciling controller for the resource.
fn job_owner_ref(owner: &JobOwner<'_>) -> serde_json::Value {
    json!({
        "apiVersion": "batch/v1",
        "kind": "Job",
        "name": owner.name,
        "uid": owner.uid,
        "blockOwnerDeletion": false,
        "controller": false,
    })
}
